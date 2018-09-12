/**
 * Detects all the word boundaries on the given input
 */
function wordBoundaries(input, leftSide = true) {
  let match;
  const words = [];
  const rx = /\w+/g;

  while ((match = rx.exec(input))) {
    if (leftSide) {
      words.push(match.index);
    } else {
      words.push(match.index + match[0].length);
    }
  }

  return words;
}

/**
 * The closest left (or right) word boundary of the given input at the
 * given offset.
 */
function closestLeftBoundary(input, offset) {
  return wordBoundaries(input, true)
    .reverse()
    .find(x => x < offset);
}
function closestRightBoundary(input, offset) {
  return wordBoundaries(input, false).find(x => x > offset);
}

/**
 * Convert offset at the given input to col/row location
 *
 * This function is not optimized and practically emulates via brute-force
 * the navigation on the terminal, wrapping when they reach the column width.
 */
function offsetToColRow(input, offset, maxCols) {
  let row = 0,
    col = 0;

  for (let i = 0; i < offset; ++i) {
    const chr = input.charAt(i);
    if (chr == "\n") {
      col = 0;
      row += 1;
    } else {
      col += 1;
      if (col > maxCols) {
        col = 0;
        row += 1;
      }
    }
  }

  return { row, col };
}

/**
 * Counts the lines in the given input
 */
function countLines(input, maxCols) {
  return offsetToColRow(input, input.length, maxCols).row + 1;
}

/**
 * Checks if there is an incomplete input
 *
 * An incomplete input is considered:
 * - An input that contains unterminated single quotes
 * - An input that contains unterminated double quotes
 * - An input that ends with "\"
 * - An input that has an incomplete boolean shell expression (&& and ||)
 * - An incomplete pipe expression (|)
 */
function isIncompleteInput(input) {
  // Empty input is not incomplete
  if (input.trim() == "") {
    return false;
  }

  // Check for dangling single-quote strings
  if ((input.match(/'/g) || []).length % 2 !== 0) {
    return true;
  }
  // Check for dangling double-quote strings
  if ((input.match(/"/g) || []).length % 2 !== 0) {
    return true;
  }
  // Check for dangling boolean or pipe operations
  if (
    input
      .split(/(\|\||\||&&)/g)
      .pop()
      .trim() == ""
  ) {
    return true;
  }
  // Check for tailing slash
  if (input.endsWith("\\") && !input.endsWith("\\\\")) {
    return true;
  }

  return false;
}

/**
 * The history controller provides an ring-buffer
 */
class HistoryController {
  constructor(size) {
    this.size = size;
    this.entries = [];
    this.cursor = 0;
  }

  /**
   * Push an entry and maintain ring buffer size
   */
  push(entry) {
    // Skip empty entries
    if (entry.trim() === "") return;
    // Skip duplicate entries
    const lastEntry = this.entries[this.entries.length - 1];
    if (entry == lastEntry) return;
    // Keep track of entries
    this.entries.push(entry);
    if (this.entries.length > this.size) {
      this.entries.pop(0);
    }
    this.cursor = this.entries.length;
  }

  /**
   * Rewind history cursor on the last entry
   */
  rewind() {
    this.cursor = this.entries.length;
  }

  /**
   * Returns the previous entry
   */
  getPrevious() {
    const idx = Math.max(0, this.cursor - 1);
    this.cursor = idx;
    return this.entries[idx];
  }

  /**
   * Returns the next entry
   */
  getNext() {
    const idx = Math.min(this.entries.length, this.cursor + 1);
    this.cursor = idx;
    return this.entries[idx];
  }
}

/**
 * A local terminal controller is responsible for displaying messages
 * and handling local echo for the terminal.
 *
 * Local echo supports most of bash-like input primitives. Namely:
 * - Arrow navigation on the input
 * - Alt-arrow for word-boundary navigation
 * - Alt-backspace for word-boundary deletion
 * - Multi-line input for incomplete commands
 * - Auto-complete hooks
 */
class LocalEchoController {
  constructor(term, historySize = 10) {
    this.term = term;
    this.term.on("data", this.handleTermData.bind(this));
    this.term.on("resize", this.handleTermResize.bind(this));
    this.history = new HistoryController(historySize);

    this._autocompleteHandlers = [];
    this._active = false;
    this._input = "";
    this._cursor = 0;
    this._activePrompt = null;
    this._termSize = {
      cols: this.term.cols,
      rows: this.term.rows
    };
  }

  /////////////////////////////////////////////////////////////////////////////
  // User-Facing API
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Register a handler that will be called to satisfy auto-completion
   */
  addAutocompleteHandler(fn) {
    this._autocompleteHandlers.push(fn);
  }

  /**
   * Remove a previously registered auto-complete handler
   */
  removeAutocompleteHandler(fn) {
    const idx = this._autocompleteHandlers.indexOf(fn);
    if (idx === -1) return;

    this._autocompleteHandlers.splice(idx, 1);
  }

  /**
   * Return a promise that will resolve when the user has completed
   * typing a single line
   */
  read(prompt, continuationPrompt = "> ") {
    return new Promise((resolve, reject) => {
      this.term.write(prompt);
      this._activePrompt = {
        prompt,
        continuationPrompt,
        resolve,
        reject
      };

      this._input = "";
      this._cursor = 0;
      this._active = true;
    });
  }

  /**
   * Abort a pending read operation
   */
  abortRead(reason = "aborted") {
    if (this._activePrompt != null) {
      this.term.write("\r\n");
      this._activePrompt.reject(reason);
      this._activePrompt = null;
    }
    this._active = false;
  }

  /**
   * Prints a message and changes line
   */
  println(message) {
    this.print(message + "\n");
  }

  /**
   * Prints a message and properly handles new-lines
   */
  print(message) {
    const normInput = message.replace(/[\r\n]+/g, "\n");
    this.term.write(normInput.replace(/\n/g, "\r\n"));
  }

  /////////////////////////////////////////////////////////////////////////////
  // Internal API
  /////////////////////////////////////////////////////////////////////////////

  /**
   * Apply prompts to the given input
   */
  applyPrompts(input) {
    const prompt = (this._activePrompt || {}).prompt || "";
    const continuationPrompt =
      (this._activePrompt || {}).continuationPrompt || "";

    return prompt + input.replace(/\n/g, "\n" + continuationPrompt);
  }

  /**
   * Advances the `offset` as required in order to accompany the prompt
   * additions to the input.
   */
  applyPromptOffset(input, offset) {
    const newInput = this.applyPrompts(input.substr(0, offset));
    return newInput.length;
  }

  /**
   * Clears the current prompt
   *
   * This function will erase all the lines that display the current prompt
   * and move the cursor in the beginning of the first line of the prompt.
   */
  clearInput() {
    const currentPrompt = this.applyPrompts(this._input);

    // Get the overall number of lines to clear
    const allRows = countLines(currentPrompt, this._termSize.cols);

    // Get the line we are currently in
    const promptCursor = this.applyPromptOffset(this._input, this._cursor);
    const { col, row } = offsetToColRow(
      currentPrompt,
      promptCursor,
      this._termSize.cols
    );

    // First move on the last line
    const moveRows = allRows - row - 1;
    for (var i = 0; i < moveRows; ++i) term.write("\x1B[E");

    // Clear current input line(s)
    term.write("\r\x1B[K");
    for (var i = 1; i < allRows; ++i) term.write("\x1B[F\x1B[K");
  }

  /**
   * Replace input with the new input given
   *
   * This function clears all the lines that the current input occupies and
   * then replaces them with the new input.
   */
  setInput(newInput, clearInput = true) {
    // Clear current input
    if (clearInput) this.clearInput();

    // Write the new input lines, including the current prompt
    const newPrompt = this.applyPrompts(newInput);
    this.print(newPrompt);

    // Trim cursor overflow
    if (this._cursor > newInput.length) {
      this._cursor = newInput.length;
    }

    // Move the cursor to the appropriate row/col
    const newCursor = this.applyPromptOffset(newInput, this._cursor);
    const newLines = countLines(newPrompt, this._termSize.cols);
    const { col, row } = offsetToColRow(
      newPrompt,
      newCursor,
      this._termSize.cols
    );
    const moveUpRows = newLines - row - 1;

    term.write("\r");
    for (var i = 0; i < moveUpRows; ++i) term.write("\x1B[F");
    for (var i = 0; i < col; ++i) this.term.write("\x1B[C");

    // Replace input
    this._input = newInput;
  }

  /**
   * Set the new cursor position, as an offset on the input string
   *
   * This function:
   * - Calculates the previous and current
   */
  setCursor(newCursor) {
    if (newCursor < 0) newCursor = 0;
    if (newCursor > this._input.length) newCursor = this._input.length;

    // Apply prompt formatting to get the visual status of the display
    const inputWithPrompt = this.applyPrompts(this._input);
    const inputLines = countLines(inputWithPrompt, this._termSize.cols);

    // Estimate previous cursor position
    const prevPromptOffset = this.applyPromptOffset(this._input, this._cursor);
    const { col: prevCol, row: prevRow } = offsetToColRow(
      inputWithPrompt,
      prevPromptOffset,
      this._termSize.cols
    );

    // Estimate next cursor position
    const newPromptOffset = this.applyPromptOffset(this._input, newCursor);
    const { col: newCol, row: newRow } = offsetToColRow(
      inputWithPrompt,
      newPromptOffset,
      this._termSize.cols
    );

    // Adjust vertically
    if (newRow > prevRow) {
      for (let i = prevRow; i < newRow; ++i) term.write("\x1B[B");
    } else {
      for (let i = newRow; i < prevRow; ++i) term.write("\x1B[A");
    }

    // Adjust horizontally
    if (newCol > prevCol) {
      for (let i = prevCol; i < newCol; ++i) term.write("\x1B[C");
    } else {
      for (let i = newCol; i < prevCol; ++i) term.write("\x1B[D");
    }

    // Set new offset
    this._cursor = newCursor;
  }

  /**
   * Move cursor at given direction
   */
  handleCursorMove(dir) {
    if (dir > 0) {
      const num = Math.min(dir, this._input.length - this._cursor);
      this.setCursor(this._cursor + num);
    } else if (dir < 0) {
      const num = Math.max(dir, -this._cursor);
      this.setCursor(this._cursor + num);
    }
  }

  /**
   * Erase a character at cursor location
   */
  handleCursorErase(backspace) {
    const { _cursor, _input } = this;
    if (backspace) {
      if (_cursor <= 0) return;
      const newInput = _input.substr(0, _cursor - 1) + _input.substr(_cursor);
      this.clearInput();
      this._cursor -= 1;
      this.setInput(newInput, false);
    } else {
      const newInput = _input.substr(0, _cursor) + _input.substr(_cursor + 1);
      this.setInput(newInput);
    }
  }

  /**
   * Insert character at cursor location
   */
  handleCursorInsert(data) {
    const { _cursor, _input } = this;
    const newInput = _input.substr(0, _cursor) + data + _input.substr(_cursor);
    this._cursor += 1;
    this.setInput(newInput);
  }

  /**
   * Handle input completion
   */
  handleReadComplete() {
    if (this.history) {
      this.history.push(this._input);
    }
    if (this._activePrompt) {
      this._activePrompt.resolve(this._input);
      this._activePrompt = null;
    }
    this.term.write("\r\n");
    this._active = false;
  }

  /**
   * Handle terminal resize
   *
   * This function clears the prompt using the previous configuration,
   * updates the cached terminal size information and then re-renders the
   * input. This leads (most of the times) into a better formatted input.
   */
  handleTermResize(data) {
    const { rows, cols } = data;
    this.clearInput();
    this._termSize = { cols, rows };
    this.setInput(this._input, false);
  }

  /**
   * Handle terminal input
   */
  handleTermData(data) {
    if (!this._active) return;

    // If this looks like a pasted input, expand it
    if (data.length > 3 && data.charCodeAt(0) !== 0x1b) {
      const normData = data.replace(/[\r\n]+/g, "\r");
      Array.from(normData).forEach(c => this.handleData(c));
    } else {
      this.handleData(data);
    }
  }

  /**
   * Handle a single piece of information from the terminal.
   */
  handleData(data) {
    if (!this._active) return;
    const ord = data.charCodeAt(0);
    let ofs;

    // Handle ANSI escape sequences
    if (ord == 0x1b) {
      switch (data.substr(1)) {
        case "[A": // Up arrow
          if (this.history) {
            let value = this.history.getPrevious();
            if (value) {
              this.setInput(value);
              this.setCursor(value.length);
            }
          }
          break;

        case "[B": // Down arrow
          if (this.history) {
            let value = this.history.getNext();
            if (!value) value = "";
            this.setInput(value);
            this.setCursor(value.length);
          }
          break;

        case "[D": // Left Arrow
          this.handleCursorMove(-1);
          break;

        case "[C": // Right Arrow
          this.handleCursorMove(1);
          break;

        case "[3~": // Delete
          this.handleCursorErase(false);
          break;

        case "[F": // End
          this.setCursor(this._input.length);
          break;

        case "[H": // Home
          this.setCursor(0);
          break;

        case "b": // ALT + LEFT
          ofs = closestLeftBoundary(this._input, this._cursor);
          if (ofs != null) this.setCursor(ofs);
          break;

        case "f": // ALT + RIGHT
          ofs = closestRightBoundary(this._input, this._cursor);
          if (ofs != null) this.setCursor(ofs);
          break;

        case "\x7F": // CTRL + BACKSPACE
          ofs = closestLeftBoundary(this._input, this._cursor);
          if (ofs != null) {
            this.setInput(
              this._input.substr(0, ofs) + this._input.substr(this._cursor)
            );
            this.setCursor(ofs);
          }
          break;
      }

      // Handle special characters
    } else if (ord < 32 || ord === 0x7f) {
      switch (data) {
        case "\r": // ENTER
          if (isIncompleteInput(this._input)) {
            this.handleCursorInsert("\n");
          } else {
            this.handleReadComplete();
          }
          break;

        case "\x7F": // BACKSPACE
          this.handleCursorErase(true);
          break;

        case "\t": // TAB
          this.handleCursorInsert("    ");
          break;

        case "\x03": // CTRL+C
          this.setCursor(this._input.length);
          this.term.write("^C\r\n" + ((this._activePrompt || {}).prompt || ""));
          this._input = "";
          this._cursor = 0;
          if (this.history) this.history.rewind();
          break;
      }

      // Handle visible characters
    } else {
      this.handleCursorInsert(data);
    }
  }
}

export default LocalEchoController;
