const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { TextDocument, SymbolKind, DocumentSymbol } = require('vscode-languageserver');
const { createMessageConnection, IPCMessageReader, IPCMessageWriter } = require('vscode-jsonrpc');
const { getDocumentSymbols } = require('../out/documentSymbols');

function document(text) {
    return TextDocument.create('file:///test.per', 'aoe2aiscript', 1, text);
}

function textAt(doc, range) {
    return doc.getText(range);
}

function testParser() {
    const text = [
        '; (defconst fake 1) (defrule)',
        '(load "(defrule) ; (defconst fake 2)")',
        '#load-if-defined FEATURE',
        '(defconst ; comment',
        '  my-goal 1)',
        '(defrule',
        '  (or (true) (false))',
        '  => (chat-to-all "quote: \\" (defconst fake 3);")',
        ')',
        '#end-if',
        '(defconst another 2)',
        '(defrule (true) => (disable-self))'
    ].join('\r\n');
    const doc = document(text);
    const symbols = getDocumentSymbols(doc);
    assert.deepStrictEqual(symbols.map(symbol => [symbol.name, symbol.kind]), [
        ['my-goal', SymbolKind.Constant],
        ['Rule 1', SymbolKind.Function],
        ['another', SymbolKind.Constant],
        ['Rule 2', SymbolKind.Function]
    ]);
    assert.ok(symbols.every(symbol => DocumentSymbol.is(symbol)));
    assert.strictEqual(textAt(doc, symbols[0].selectionRange), 'my-goal');
    assert.strictEqual(textAt(doc, symbols[0].range), '(defconst ; comment\r\n  my-goal 1)');
    assert.strictEqual(textAt(doc, symbols[1].selectionRange), 'defrule');
    assert.strictEqual(textAt(doc, symbols[1].range),
        '(defrule\r\n  (or (true) (false))\r\n  => (chat-to-all "quote: \\" (defconst fake 3);")\r\n)');
    assert.strictEqual(symbols[0].selectionRange.start.line, 4);

    const incomplete = document('(defconst missing\n(defrule (true)');
    assert.deepStrictEqual(getDocumentSymbols(incomplete).map(symbol => symbol.name), ['missing']);
    const unfinishedRule = document('(defrule (true)\n => (chat-to-all "hello');
    const unfinished = getDocumentSymbols(unfinishedRule);
    assert.strictEqual(unfinished[0].name, 'Rule 1');
    assert.strictEqual(textAt(unfinishedRule, unfinished[0].range), unfinishedRule.getText());
    assert.deepStrictEqual(getDocumentSymbols(document(
        '(defconst) (defconst "not-a-name" 1) ("x" defrule) ((defrule)) ; (defrule)'
    )), []);

    const sample = fs.readFileSync(path.join(__dirname, '../../samples/ai_sample.per'), 'utf8');
    assert.deepStrictEqual(getDocumentSymbols(document(sample)).map(symbol => symbol.name),
        ['go-to-feudal', 'cur-game-time', 'Rule 1']);
}

async function testServer() {
    const server = fork(path.join(__dirname, '../out/server.js'), ['--node-ipc'], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc']
    });
    const connection = createMessageConnection(new IPCMessageReader(server), new IPCMessageWriter(server));
    connection.listen();
    const uri = 'file:///outline-test.per';
    try {
        const initialized = await connection.sendRequest('initialize', {
            processId: process.pid,
            rootUri: null,
            capabilities: { textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } } }
        });
        assert.strictEqual(initialized.capabilities.documentSymbolProvider, true);
        connection.sendNotification('initialized', {});
        connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri, languageId: 'aoe2aiscript', version: 1, text: '(defconst original 1)' }
        });
        let symbols = await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } });
        assert.deepStrictEqual(symbols.map(symbol => symbol.name), ['original']);

        connection.sendNotification('textDocument/didChange', {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: '(defconst changed 1)\n(defrule (true) => (disable-self))' }]
        });
        symbols = await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } });
        assert.deepStrictEqual(symbols.map(symbol => symbol.name), ['changed', 'Rule 1']);
        connection.sendNotification('textDocument/didClose', { textDocument: { uri } });
        symbols = await connection.sendRequest('textDocument/documentSymbol', { textDocument: { uri } });
        assert.deepStrictEqual(symbols, []);
        await connection.sendRequest('shutdown');
        connection.sendNotification('exit');
    } finally {
        connection.dispose();
        server.kill();
    }
}

testParser();
testServer().then(() => console.log('Outline tests passed'), error => {
    console.error(error);
    process.exitCode = 1;
});
