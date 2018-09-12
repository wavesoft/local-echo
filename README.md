# term-echo

> A fully functional local echo controller for xterm.js

You will be surprised how difficult it is to implement a fully functional local-echo controller for [xterm.js](https://github.com/xtermjs/xterm.js) (or any other terminal emulator). This project takes this burden off your hands.

### Features

The local echo controller tries to replicate most of the bash-like user experience primitives, such as:

1. **Arrow Navigation** - Use `left` and `right` arrows to navigate in your input
2. **Word-Boundary Navigation** - Use `alt+left` and `alt+right` to jump between words
3. **Word-Boundary Deletion** - Use `alt+backspace` to delete a word
4. **Multi-Line Continuation** - Break command to multiple lines if they contain incomplete quotation marks, boolean operators (`&&` or `||`), pipe operator (`|`), or new-line escape sequence (`\`).
5. **Fully-Editable Multi-Line Continuation** - Navigate with your arrows and modify any line in your multi-line command.
5. **Local History** - Just like bash, access the commands you previously typed using the `up` and `down` arrows.
6. **Tab-Completion** - Provides callbacks where you can registry your custom tab-completion methods.

# Installation

```sh
npm install --save wavesoft/local-echo
```

# Usage

```js
import { Terminal } from 'xterm';
import LocalEchoController from 'local-echo';

// Start an xterm.js instance
const term = new Terminal();
term.open(document.getElementById('terminal'));

// Create a local echo controller
const localEcho = new LocalEchoController(term);

// Read a single line from the user
localEcho.read("~$ ")
    .then(input => alert(`User entered: ${input}`))
    .catch(error => alert(`Error reading: ${error}`));
```

