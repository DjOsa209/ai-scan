package codeindex

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
)

type Function struct {
	Path      string
	Name      string
	StartLine int
	EndLine   int
	Content   string
	calls     []string
	terms     map[string]struct{}
}

type Index struct {
	functions []Function
	byName    map[string][]int
}

type Options struct {
	MaxDepth     int
	MaxFunctions int
	MaxBytes     int
}

var (
	identifierPattern  = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]*`)
	pythonDefPattern   = regexp.MustCompile(`^(\s*)(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(`)
	callPattern        = regexp.MustCompile(`([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\(`)
	javaScriptPatterns = []functionPattern{
		{expression: regexp.MustCompile(`(?m)^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:async[ \t]+)?function[ \t]+([$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?:<[^>{}\n]*>)?[ \t]*\([^{};\n]*\)[^{;\n]*\{`), nameGroup: 1},
		{expression: regexp.MustCompile(`(?m)^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=[ \t]*(?:async[ \t]+)?(?:\([^{}\n]*\)|[$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=>[ \t]*\{`), nameGroup: 1},
		{expression: regexp.MustCompile(`(?m)^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=[ \t]*(?:async[ \t]+)?function(?:[ \t]+[$A-Za-z_][$A-Za-z0-9_]*)?[ \t]*\([^{};\n]*\)[^{;\n]*\{`), nameGroup: 1},
		{expression: regexp.MustCompile(`(?m)^[ \t]*(?:(?:public|private|protected|static|async|override|readonly|get|set)[ \t]+)*([$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?:<[^>{}\n]*>)?[ \t]*\([^{};\n]*\)[^{;\n]*\{`), nameGroup: 1},
	}
	javaScriptExpressionArrow = regexp.MustCompile(`(?m)^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=[ \t]*(?:async[ \t]+)?(?:\([^{}\n]*\)|[$A-Za-z_][$A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=>[^\n{]+$`)
)

var ignoredTerms = map[string]struct{}{
	"and": {}, "bool": {}, "class": {}, "context": {}, "def": {}, "else": {}, "error": {}, "false": {},
	"for": {}, "from": {}, "func": {}, "if": {}, "import": {}, "int": {}, "interface": {}, "nil": {},
	"none": {}, "package": {}, "return": {}, "self": {}, "string": {}, "struct": {}, "true": {}, "with": {},
}

func Build(root string, paths []string) (*Index, error) {
	index := &Index{byName: map[string][]int{}}
	for _, relative := range paths {
		clean, err := cleanPath(relative)
		if err != nil {
			return nil, err
		}
		content, err := os.ReadFile(filepath.Join(root, clean))
		if err != nil {
			continue
		}
		var functions []Function
		switch strings.ToLower(filepath.Ext(clean)) {
		case ".go":
			functions = parseGo(relative, content)
		case ".py":
			functions = parsePython(relative, content)
		case ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx":
			functions = parseJavaScript(relative, content)
		}
		for _, function := range functions {
			position := len(index.functions)
			index.functions = append(index.functions, function)
			index.byName[strings.ToLower(function.Name)] = append(index.byName[strings.ToLower(function.Name)], position)
		}
	}
	return index, nil
}

func (index *Index) Related(source string, excludedPaths map[string]struct{}, options Options) []Function {
	if options.MaxDepth < 1 {
		options.MaxDepth = 1
	}
	if options.MaxFunctions < 1 || options.MaxBytes < 1 {
		return nil
	}
	queryTerms := terms(source)
	selected := map[int]struct{}{}
	result := make([]Function, 0, options.MaxFunctions)
	usedBytes := 0

	for depth := 0; depth < options.MaxDepth && len(result) < options.MaxFunctions; depth++ {
		var candidates []scoredFunction
		for position, function := range index.functions {
			if _, excluded := excludedPaths[function.Path]; excluded {
				continue
			}
			if _, exists := selected[position]; exists {
				continue
			}
			score := score(function, queryTerms)
			if score > 0 {
				candidates = append(candidates, scoredFunction{position: position, score: score})
			}
		}
		sort.Slice(candidates, func(left, right int) bool {
			if candidates[left].score == candidates[right].score {
				return index.functions[candidates[left].position].Path < index.functions[candidates[right].position].Path
			}
			return candidates[left].score > candidates[right].score
		})

		added := false
		for _, candidate := range candidates {
			function := index.functions[candidate.position]
			if usedBytes+len(function.Content) > options.MaxBytes {
				continue
			}
			selected[candidate.position] = struct{}{}
			result = append(result, function)
			usedBytes += len(function.Content)
			for _, call := range function.calls {
				queryTerms[strings.ToLower(call)] = struct{}{}
			}
			added = true
			if len(result) >= options.MaxFunctions {
				break
			}
		}
		if !added {
			break
		}
	}
	return result
}

func parseGo(path string, content []byte) []Function {
	fileSet := token.NewFileSet()
	file, err := parser.ParseFile(fileSet, path, content, 0)
	if err != nil {
		return nil
	}
	lines := strings.Split(string(content), "\n")
	var functions []Function
	for _, declaration := range file.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Body == nil {
			continue
		}
		start := fileSet.Position(function.Pos()).Line
		end := fileSet.Position(function.End()).Line
		calls := []string{}
		ast.Inspect(function.Body, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok {
				return true
			}
			if name := calledName(call.Fun); name != "" && !slices.Contains(calls, name) {
				calls = append(calls, name)
			}
			return true
		})
		functions = append(functions, newFunction(path, function.Name.Name, start, end, lines, calls))
	}
	return functions
}

func calledName(expression ast.Expr) string {
	switch value := expression.(type) {
	case *ast.Ident:
		return value.Name
	case *ast.SelectorExpr:
		return value.Sel.Name
	default:
		return ""
	}
}

func parsePython(path string, content []byte) []Function {
	lines := strings.Split(string(content), "\n")
	var functions []Function
	for lineIndex := 0; lineIndex < len(lines); lineIndex++ {
		match := pythonDefPattern.FindStringSubmatch(lines[lineIndex])
		if match == nil {
			continue
		}
		indent := len(strings.ReplaceAll(match[1], "\t", "    "))
		end := len(lines)
		for next := lineIndex + 1; next < len(lines); next++ {
			trimmed := strings.TrimSpace(lines[next])
			if trimmed == "" || strings.HasPrefix(trimmed, "#") {
				continue
			}
			nextIndent := len(strings.ReplaceAll(lines[next][:len(lines[next])-len(strings.TrimLeft(lines[next], " \t"))], "\t", "    "))
			if nextIndent <= indent {
				end = next
				break
			}
		}
		for end > lineIndex+1 && strings.TrimSpace(lines[end-1]) == "" {
			end--
		}
		body := strings.Join(lines[lineIndex:end], "\n")
		functions = append(functions, newFunction(path, match[2], lineIndex+1, end, lines, calledNames(body)))
	}
	return functions
}

type functionPattern struct {
	expression *regexp.Regexp
	nameGroup  int
}

func parseJavaScript(path string, content []byte) []Function {
	source := string(content)
	lines := strings.Split(source, "\n")
	seen := map[int]struct{}{}
	var functions []Function
	for _, pattern := range javaScriptPatterns {
		for _, match := range pattern.expression.FindAllStringSubmatchIndex(source, -1) {
			startOffset := match[0]
			for startOffset < len(source) && source[startOffset] == '\n' {
				startOffset++
			}
			if _, exists := seen[startOffset]; exists {
				continue
			}
			nameStart := match[pattern.nameGroup*2]
			nameEnd := match[pattern.nameGroup*2+1]
			name := source[nameStart:nameEnd]
			if ignoredJavaScriptFunction(name) {
				continue
			}
			openBrace := strings.LastIndex(source[match[0]:match[1]], "{") + match[0]
			endOffset := matchingBrace(source, openBrace)
			if endOffset < 0 {
				continue
			}
			startLine := lineNumberAt(source, startOffset)
			endLine := lineNumberAt(source, endOffset)
			body := source[startOffset : endOffset+1]
			functions = append(functions, newFunction(path, name, startLine, endLine, lines, calledNames(body)))
			seen[startOffset] = struct{}{}
		}
	}
	for _, match := range javaScriptExpressionArrow.FindAllStringSubmatchIndex(source, -1) {
		startOffset := match[0]
		if _, exists := seen[startOffset]; exists {
			continue
		}
		name := source[match[2]:match[3]]
		line := lineNumberAt(source, startOffset)
		body := source[match[0]:match[1]]
		functions = append(functions, newFunction(path, name, line, line, lines, calledNames(body)))
	}
	return functions
}

func ignoredJavaScriptFunction(name string) bool {
	switch name {
	case "if", "for", "while", "switch", "catch":
		return true
	default:
		return false
	}
}

func matchingBrace(source string, open int) int {
	depth := 0
	var quote byte
	escaped := false
	lineComment := false
	blockComment := false
	for position := open; position < len(source); position++ {
		current := source[position]
		next := byte(0)
		if position+1 < len(source) {
			next = source[position+1]
		}
		if lineComment {
			if current == '\n' {
				lineComment = false
			}
			continue
		}
		if blockComment {
			if current == '*' && next == '/' {
				blockComment = false
				position++
			}
			continue
		}
		if quote != 0 {
			if escaped {
				escaped = false
				continue
			}
			if current == '\\' {
				escaped = true
				continue
			}
			if current == quote {
				quote = 0
			}
			continue
		}
		if current == '/' && next == '/' {
			lineComment = true
			position++
			continue
		}
		if current == '/' && next == '*' {
			blockComment = true
			position++
			continue
		}
		if current == '\'' || current == '"' || current == '`' {
			quote = current
			continue
		}
		switch current {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return position
			}
		}
	}
	return -1
}

func lineNumberAt(source string, offset int) int {
	return strings.Count(source[:offset], "\n") + 1
}

func calledNames(content string) []string {
	var result []string
	for _, match := range callPattern.FindAllStringSubmatch(content, -1) {
		parts := strings.Split(match[1], ".")
		name := parts[len(parts)-1]
		if !slices.Contains(result, name) {
			result = append(result, name)
		}
	}
	return result
}

func newFunction(path, name string, start, end int, lines []string, calls []string) Function {
	var content strings.Builder
	content.WriteString("\n--- RELATED FUNCTION: ")
	content.WriteString(path)
	content.WriteString(" ---\n")
	for line := start; line <= end && line <= len(lines); line++ {
		fmt.Fprintf(&content, "%d|%s\n", line, lines[line-1])
	}
	return Function{Path: path, Name: name, StartLine: start, EndLine: end, Content: content.String(), calls: calls, terms: terms(strings.Join(lines[start-1:min(end, len(lines))], "\n"))}
}

func terms(content string) map[string]struct{} {
	result := map[string]struct{}{}
	for _, value := range identifierPattern.FindAllString(content, -1) {
		value = strings.ToLower(value)
		if len(value) < 3 {
			continue
		}
		if _, ignored := ignoredTerms[value]; !ignored {
			result[value] = struct{}{}
		}
	}
	return result
}

type scoredFunction struct {
	position int
	score    int
}

func score(function Function, query map[string]struct{}) int {
	if _, exact := query[strings.ToLower(function.Name)]; exact {
		return 100
	}
	overlap := 0
	for term := range function.terms {
		if _, exists := query[term]; exists {
			overlap++
		}
	}
	if overlap < 3 {
		return 0
	}
	return overlap
}

func cleanPath(path string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(path))
	if clean == "." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid source path %q", path)
	}
	return clean, nil
}
