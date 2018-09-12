# 📢 local-echo

> A fully functional local echo controller for xterm.js

You will be surprised how difficult it is to implement a fully functional local-echo controller for [xterm.js](https://github.com/xtermjs/xterm.js) (or any other terminal emulator). This project takes this burden off your hands.

### Features

The local echo controller tries to replicate most of the bash-like user experience primitives, such as:

- _Arrow navigation_: Use `left` and `right` arrows to navigate in your input
- _Word-boundary navigation_: Use `alt+left` and `alt+right` to jump between words
- _Word-boundary deletion_: Use `alt+backspace` to delete a word
- _Multi-line continuation_: Break command to multiple lines if they contain incomplete quotation marks, boolean operators (`&&` or `||`), pipe operator (`|`), or new-line escape sequence (`\`).
- _Full-navigation on multi-line command_: You are not limited only on the line you are editing, you can navigate and edit all of your lines.
- _Local History_: Just like bash, access the commands you previously typed using the `up` and `down` arrows.
- _Tab-Completion_: Provides support for registering your own tab-completion callbacks.

# Usage

## As ES6 Module

1. Install it using `npm`:

    ```sh
    npm install --save wavesoft/local-echo
    ```

    Or yarn:

    ```sh
    yarn add wavesoft/local-echo
    ```

2. Use it like so:

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

## Directly in the browser

1. Download `local-echo.js` from the latest [release](/wavesoft/local-echo/releases)
2. Include it in your HTML:

    ```
    <script src="/local-echo.js"></script>
    ```

3. Use it like so:

    ```js
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

