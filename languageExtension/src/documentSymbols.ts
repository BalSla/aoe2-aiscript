import { DocumentSymbol, SymbolKind, TextDocument } from 'vscode-languageserver';

interface Expression {
    start: number;
    head?: string;
    headStart?: number;
    headEnd?: number;
    name?: string;
    nameStart?: number;
    nameEnd?: number;
    ruleNumber?: number;
    invalidName?: boolean;
}

export function getDocumentSymbols(document: TextDocument): DocumentSymbol[] {
    const text = document.getText();
    const symbols: DocumentSymbol[] = [];
    let depth = 0;
    let expression: Expression;
    let ruleCount = 0;
    let i = 0;

    function finish(end: number): void {
        if (!expression) {
            return;
        }
        let name: string;
        let kind: SymbolKind;
        let selectionStart: number;
        let selectionEnd: number;
        if (expression.head === 'defrule') {
            name = 'Rule ' + expression.ruleNumber;
            kind = SymbolKind.Function;
            selectionStart = expression.headStart;
            selectionEnd = expression.headEnd;
        } else if (expression.head === 'defconst' && expression.name) {
            name = expression.name;
            kind = SymbolKind.Constant;
            selectionStart = expression.nameStart;
            selectionEnd = expression.nameEnd;
        } else {
            return;
        }
        symbols.push({
            name,
            kind,
            range: { start: document.positionAt(expression.start), end: document.positionAt(end) },
            selectionRange: { start: document.positionAt(selectionStart), end: document.positionAt(selectionEnd) }
        });
    }

    while (i < text.length) {
        const char = text[i];
        if (char === ';') {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
                i++;
            }
        } else if (char === '"') {
            if (depth === 1 && expression) {
                if (!expression.head) {
                    expression.head = '"';
                } else if (expression.head === 'defconst' && !expression.name) {
                    expression.invalidName = true;
                }
            }
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\' && i + 1 < text.length) {
                    i++;
                }
                i++;
            }
            if (i < text.length) {
                i++;
            }
        } else if (char === '(') {
            if (depth === 0) {
                expression = { start: i };
            } else if (depth === 1 && expression) {
                if (!expression.head) {
                    expression.head = '(';
                } else if (expression.head === 'defconst' && !expression.name) {
                    expression.invalidName = true;
                }
            }
            depth++;
            i++;
        } else if (char === ')') {
            if (depth > 0) {
                depth--;
                if (depth === 0) {
                    finish(i + 1);
                    expression = undefined;
                }
            }
            i++;
        } else if (/\s/.test(char)) {
            i++;
        } else {
            const start = i;
            while (i < text.length && !/[\s();"]/.test(text[i])) {
                i++;
            }
            if (depth === 1 && expression) {
                const token = text.substring(start, i);
                if (!expression.head) {
                    expression.head = token.toLowerCase();
                    expression.headStart = start;
                    expression.headEnd = i;
                    if (expression.head === 'defrule') {
                        expression.ruleNumber = ++ruleCount;
                    }
                } else if (expression.head === 'defconst' && !expression.name && !expression.invalidName) {
                    expression.name = token;
                    expression.nameStart = start;
                    expression.nameEnd = i;
                }
            }
        }
    }
    if (depth > 0) {
        finish(text.length);
    }
    return symbols;
}
