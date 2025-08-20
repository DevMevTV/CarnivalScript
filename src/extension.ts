import * as vscode from "vscode"

const INSTRUCTIONS: Record<string, string[][]> = {
            MOV: [["Reg","Num"], ["Reg"]],
            LOD: [["Num"], ["Reg"]],
            STR: [["Reg","Num"], ["Num"]],
            PSH: [["Reg","Num"]],
            POP: [["Reg"]],
            ADD: [["Reg","Num"], ["Reg","Num"], ["Reg"]],
            SUB: [["Reg","Num"], ["Reg","Num"], ["Reg"]],
            MOD: [["Reg","Num"], ["Reg","Num"], ["Reg"]],
            XOR: [["Reg","Num"], ["Reg","Num"], ["Reg"]],
            AND: [["Reg","Num"], ["Reg","Num"], ["Reg"]],
            NOT: [["Reg","Num"], ["Reg"]],
            OR:  [["Reg","Num"], ["Reg","Num"], ["Reg"]],
            JMP: [["Num","Label"]],
            CAL: [["Num","Label"]],
            RET: [],
            BRZ: [["Reg","Num"], ["Num","Label"]],
            BNZ: [["Reg","Num"], ["Num","Label"]],
            IN:  [["Num"], ["Reg"]],
            OUT: [["Num"], ["Reg","Num","String"]],
            GIP: [["Reg"]],
            HLT: [],
            BRG: [["Reg", "Num"], ["Reg", "Num"], ["Label", "Num"]],
            BNG: [["Reg", "Num"], ["Reg", "Num"], ["Label", "Num"]],
            BRL: [["Reg", "Num"], ["Reg", "Num"], ["Label", "Num"]],
            BNL: [["Reg", "Num"], ["Reg", "Num"], ["Label", "Num"]]
        }

export function activate(context: vscode.ExtensionContext) {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("carnival")
    context.subscriptions.push(diagnosticCollection)

    const updateDiagnostics  = (doc: vscode.TextDocument) => {
        if (doc.languageId !== "carnival") return

        const diagnostics: vscode.Diagnostic[] = []
        const text = doc.getText()

        // Check for missing meta keys
        const requiredKeys = ["meta.name", "meta.version", "meta.author"]
        for (const key of requiredKeys) {
            if (!text.includes(key)) {
                const diagnostic = new vscode.Diagnostic(
                    new vscode.Range(0, 0, 0, 0),
                    `Missing key: ${key}`,
                    vscode.DiagnosticSeverity.Information
                )

                diagnostic.code = `missing_${key}`
                diagnostics.push(diagnostic)
            }
        }

        // Check for invalid register usage
        const registerRegex = /\b(r\d{1,2})\b/gi
        let match
        while ((match = registerRegex.exec(text)) !== null) {
            const regNum = parseInt(match[1].substring(1))
            if (regNum < 0 || regNum > 15) {
                const startPos = doc.positionAt(match.index)
                const endPos = doc.positionAt(match.index + match[1].length)
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(startPos, endPos),
                    `Invalid register: ${match[1]}`,
                    vscode.DiagnosticSeverity.Error
                ))
            }
        }

        const lines = text.split(/\r?\n/)
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum].trim()
            if (!line) continue

            const parts = line.match(/'[^']*'|\S+/g)
            if (parts == undefined || parts.length === 0) continue
            const instruction = parts[0].toUpperCase()
            const args = parts.slice(1)

            const signature = INSTRUCTIONS[instruction]
            if (!signature) {
                const firstPart = parts[0]

                if (firstPart.startsWith("#")) continue
                const metaKeys = ["meta.name", "meta.version", "meta.author"]
                if (metaKeys.includes(firstPart)) continue
                if (firstPart.startsWith(".")) continue

                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(lineNum, 0, lineNum, firstPart.length),
                    `Invalid instruction: ${instruction}`,
                    vscode.DiagnosticSeverity.Error
                ))
                continue
            }

            // argument count
            if (args.length !== signature.length) {
                diagnostics.push(new vscode.Diagnostic(
                    new vscode.Range(lineNum, 0, lineNum, line.length),
                    `Instruction ${instruction} expects ${signature.length} argument(s), got ${args.length}`,
                    vscode.DiagnosticSeverity.Error
                ))
                continue
            }

            // argument type checks
            for (let i = 0; i < signature.length; i++) {
                const expectedKinds = signature[i]
                const actual = args[i]
                let valid = false

                for (const kind of expectedKinds) {
                    if (kind === "Reg" && /^r\d{1,2}$/i.test(actual)) valid = true
                    if (kind === "Num" && /^\d+$/.test(actual)) valid = true
                    if (kind === "Label" && /^(\.|[A-Za-z_])[\w.]*$/.test(actual)) valid = true
                    if (kind === "String" && /^'.*'$/.test(actual)) valid = true
                }

                if (!valid) {
                    diagnostics.push(new vscode.Diagnostic(
                        new vscode.Range(lineNum, 0, lineNum, line.length),
                        `Invalid argument '${actual}' for ${instruction}. Expected: ${expectedKinds.join(" or ")}`,
                        vscode.DiagnosticSeverity.Error
                    ))
                }
            }
        }

        diagnosticCollection.set(doc.uri, diagnostics)
    }

    vscode.workspace.onDidSaveTextDocument(updateDiagnostics)
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics)
    vscode.workspace.onDidChangeTextDocument(e => updateDiagnostics(e.document))

    // Quickfix provider
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider("carnival", new CarnivalQuickFix(), {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        })
    )

    // Completion provider
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            "carnival",
            new CarnivalCompletionProvider()
        )
    )
}

class CarnivalQuickFix implements vscode.CodeActionProvider {
    provideCodeActions(
        document: vscode.TextDocument,
        range: vscode.Range,
        context: vscode.CodeActionContext,
        token: vscode.CancellationToken
    ): vscode.CodeAction[] {
        const fixes: vscode.CodeAction[] = []

        for (const diagnostic of context.diagnostics) {
            if (typeof diagnostic.code === "string" && diagnostic.code.startsWith("missing_meta")) {
                const key = diagnostic.code.replace("missing_", "")

                const defaults: Record<string, string> = {
                    "meta.name": "Program",
                    "meta.version": "0.1",
                    "meta.author": "Me"
                }

                const fix = new vscode.CodeAction(`Insert ${key}`, vscode.CodeActionKind.QuickFix)
                fix.edit = new vscode.WorkspaceEdit()
                fix.edit.insert(document.uri, new vscode.Position(0, 0), `${key} '${defaults[key]}'\n`)
                fix.diagnostics = [diagnostic]
                fixes.push(fix)
            }
        }

        return fixes
    }
}

class CarnivalCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        return Object.keys(INSTRUCTIONS).map(inst => inst.toLowerCase()).map(inst => {
            const item = new vscode.CompletionItem(inst, vscode.CompletionItemKind.Keyword)
            item.insertText = inst
            item.detail = "Carnival instruction"
            return item
        })
    }
}