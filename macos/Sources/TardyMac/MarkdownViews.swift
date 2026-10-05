import SwiftUI

enum MarkdownBlock: Equatable {
    case prose(String)
    case table(headers: [String], rows: [[String]])
    case code(language: String, source: String)
}

enum MarkdownBlocks {
    static func parse(_ source: String) -> [MarkdownBlock] {
        let lines = source.components(separatedBy: .newlines)
        var blocks: [MarkdownBlock] = []
        var prose: [String] = []
        var index = 0

        func flushProse() {
            let value = prose.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { blocks.append(.prose(value)) }
            prose.removeAll(keepingCapacity: true)
        }

        while index < lines.count {
            let line = lines[index].trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") {
                flushProse()
                let language = String(line.dropFirst(3))
                index += 1
                var code: [String] = []
                while index < lines.count && !lines[index].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[index]); index += 1
                }
                if index < lines.count { index += 1 }
                blocks.append(.code(language: language, source: code.joined(separator: "\n")))
                continue
            }
            if index + 1 < lines.count {
                let headers = cells(in: lines[index])
                let divider = cells(in: lines[index + 1])
                if headers.count >= 2,
                   divider.count == headers.count,
                   divider.allSatisfy(isDividerCell) {
                    flushProse()
                    index += 2
                    var rows: [[String]] = []
                    while index < lines.count {
                        let row = cells(in: lines[index])
                        guard row.count == headers.count else { break }
                        rows.append(row)
                        index += 1
                    }
                    blocks.append(.table(headers: headers, rows: rows))
                    continue
                }
            }
            prose.append(lines[index])
            index += 1
        }
        flushProse()
        return blocks
    }

    private static func cells(in line: String) -> [String] {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.contains("|") else { return [] }
        let content = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
        var cells: [String] = []
        var cell = ""
        var escaped = false
        for character in content {
            if escaped {
                cell.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "|" {
                cells.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else {
                cell.append(character)
            }
        }
        if escaped { cell.append("\\") }
        cells.append(cell.trimmingCharacters(in: .whitespaces))
        return cells
    }

    private static func isDividerCell(_ cell: String) -> Bool {
        let compact = cell.replacingOccurrences(of: " ", with: "")
        let core = compact.trimmingCharacters(in: CharacterSet(charactersIn: ":"))
        return core.count >= 3 && core.allSatisfy { $0 == "-" }
    }
}

struct RichMarkdownView: View {
    let source: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(MarkdownBlocks.parse(source).enumerated()), id: \.offset) { _, block in
                switch block {
                case let .prose(text):
                    Text(.init(text)).textSelection(.enabled)
                case let .table(headers, rows):
                    MarkdownTable(headers: headers, rows: rows)
                case let .code(language, source):
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(language.isEmpty ? "Code" : language).font(.caption).foregroundStyle(Brand.muted)
                            Spacer()
                            Button {
                                NSPasteboard.general.clearContents()
                                NSPasteboard.general.setString(source, forType: .string)
                            } label: { Label("Copy", systemImage: "doc.on.doc") }.buttonStyle(.plain).font(.caption)
                        }
                        ScrollView(.horizontal) {
                            Text(source).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }.padding(12).background(Brand.background, in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

private struct MarkdownTable: View {
    let headers: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow { tableRow(headers, header: true) }
                ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                    GridRow { tableRow(row, header: false) }
                        .background(index.isMultiple(of: 2) ? Color.white.opacity(0.035) : .clear)
                }
            }
            .overlay { RoundedRectangle(cornerRadius: 8).stroke(Brand.separator) }
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .scrollIndicators(.visible)
    }

    @ViewBuilder
    private func tableRow(_ cells: [String], header: Bool) -> some View {
        ForEach(Array(cells.enumerated()), id: \.offset) { index, cell in
            Text(.init(cell))
                .font(header ? .caption.bold() : .caption)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(minWidth: 100, maxWidth: 260, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(header ? Brand.yellow.opacity(0.14) : .clear)
                .overlay(alignment: .trailing) {
                    if index < cells.count - 1 { Rectangle().fill(Brand.separator).frame(width: 1) }
                }
        }
    }
}
