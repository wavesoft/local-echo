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
 * Counts the lines in the given input
 */
function countLines(input, cols) {
  const lines = input.split("\n");
  return lines.reduce((count, line) => {
    return count + Math.ceil(line.length / cols)
  }, 0);
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
 *
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
  if (input.endsWith("\\")) {
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
  }

  /**
   * Push an entry and maintain ring buffer size
   */
  add(entry) {
    this.entries.push(entry);
    if (this.entries.length > this.size) {
      this.entries.pop(0);
    }
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
 *
 * Caveats / Known bugs:
 * - Tab characters are replaced with 4 spaces
 */
class LocalEchoController {
  constructor(term, historySize=10) {
    this.term = term;
    this.term.on("data", this.handleData.bind(this));
    this.history = new HistoryController(historySize);

    this._autocompleteHandlers = [];
    this._active = false;
    this._input = "";
    this._cursor = 0;
    this._breakPoint = 0;
    this._activePrompt = null;
  }

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
  read(prompt, continuationPrompt = "→ ") {
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
      this._breakPoint = 0;
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

  /**
   * Replace input with the new input given
   *
   * This function:
   * - Overwrites the current input by using the back arrow until it hits
   *   the beginning of the current input, and then writing the new over.
   * - Erases smaller input, replacing them with empty characters.
   * - Remembers the last cursor position and tries to re-position it.
   *
   */
  setInput(newInput) {
    const breakOffset = this._cursor - this._breakPoint;

    // Replace input
    for (var i = 0; i < breakOffset; ++i) this.term.write("\x1B[D");
    this.term.write(newInput.substr(this._breakPoint));

    // Erase characters
    const erase = Math.max(0, this._input.length - newInput.length);
    for (var i = 0; i < erase; ++i) this.term.write(" ");
    for (var i = 0; i < erase; ++i) this.term.write("\x1B[D");

    // Trim cursor overflow
    if (this._cursor > newInput.length) {
      this._cursor = newInput.length;
    }

    // Apply cursor correction
    const cursorCorr = Math.max(0, newInput.length - this._cursor);
    for (var i = 0; i < cursorCorr; ++i) this.term.write("\x1B[D");

    this._input = newInput;
  }

  /**
   * Set the new cursor position
   */
  setCursor(newCursor) {
    if (newCursor < this._breakPoint) newCursor = this._breakPoint;
    if (newCursor > this._input.length) newCursor = this._input.length;
    const offset = newCursor - this._cursor;
    this.handleCursorMove(offset);
  }

  /**
   * Move cursor at given direction
   */
  handleCursorMove(dir) {
    if (dir > 0) {
      const num = Math.min(dir, this._input.length - this._cursor);
      this._cursor += num;
      for (let i = 0; i < num; ++i) this.term.write("\x1B[C");
    } else if (dir < 0) {
      const num = Math.max(dir, -this._cursor);
      this._cursor += num;
      for (let i = num; i < 0; ++i) this.term.write("\x1B[D");
    }
  }

  /**
   * Erase a character at cursor location
   */
  handleCursorErase(backspace) {
    const { _cursor, _input } = this;
    if (backspace) {
      if (_cursor <= this._breakPoint) return;
      const newInput = _input.substr(0, _cursor - 1) + _input.substr(_cursor);
      this.handleCursorMove(-1);
      this.setInput(newInput);
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
    this.setInput(newInput);
    this.handleCursorMove(data.length);
  }

  /**
   * Handle input completion
   */
  handleCompletion() {
    if (this._activePrompt) {
      this._activePrompt.resolve(this._input);
      this._activePrompt = null;
    }
    this.term.write("\r\n");
    this._active = false;
  }

  /**
   * Handle terminal input
   */
  handleData(data) {
    let ofs;
    const ord = data.charCodeAt(0);
    if (!this._active) return;

    // Handle ANSI escape sequences
    if (ord == 0x1b) {
      switch (data.substr(1)) {
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
          this.setCursor(this._breakPoint);
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
          if (ofs != null && ofs >= this._breakPoint) {
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
            // Strip new-line escape
            if (this._input.endsWith("\\")) {
              this._input = this._input.substr(0, this._input.length - 1);
              this._cursor -= 1;
            } else {
              this._input += "\n";
              this._cursor += 1;
            }

            this._breakPoint = this._cursor;
            this.term.write(
              "\r\n" + ((this._activePrompt || {}).continuationPrompt || "> ")
            );
          } else {
            this.handleCompletion();
          }
          break;

        case "\x7F": // BACKSPACE
          this.handleCursorErase(true);
          break;

        case "\t": // TAB
          this.handleCursorInsert("    ");
          break;

        case "\x03": // CTRL+C
          this.term.write("^C\r\n" + ((this._activePrompt || {}).prompt || ""));
          this._input = "";
          this._breakPoint = 0;
          this._cursor = 0;
          break;
      }

      // Handle visible characters
    } else {
      // In the case where the user has pasted an input blob, we should
      // normalize the input.
      data = data.replace(/[\r\n]/g, " ");

      this.handleCursorInsert(data);
    }
  }
}

module.exports = LocalEchoController;
