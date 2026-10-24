import ts from "typescript";

const ROOTS = new Set(["describe", "it", "test", "suite", "bench"]);
const ALIASES = new Set(["fit", "fdescribe", "xit", "xtest", "xdescribe"]);

/** Follow the callee only: arguments may contain independent tests or fixtures. */
function testChain(expression) {
  if (ts.isIdentifier(expression)) {
    const name = expression.text;
    return ROOTS.has(name) || ALIASES.has(name)
      ? { root: expression, focused: ALIASES.has(name), snippet: name }
      : null;
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return testChain(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    const chain = testChain(expression.expression);
    return chain && { ...chain, snippet: `${chain.snippet}(…)` };
  }
  if (ts.isTaggedTemplateExpression(expression)) {
    const chain = testChain(expression.tag);
    return chain && { ...chain, snippet: `${chain.snippet}\`…\`` };
  }
  let receiver;
  let member;
  if (ts.isPropertyAccessExpression(expression)) {
    receiver = expression.expression;
    member = expression.name.text;
  } else if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    (ts.isStringLiteral(expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
  ) {
    receiver = expression.expression;
    member = expression.argumentExpression.text;
  } else {
    return null;
  }
  const chain = testChain(receiver);
  return chain && {
    ...chain,
    focused: chain.focused || member === "only" || member === "skip",
    snippet: `${chain.snippet}.${member}`,
  };
}

/**
 * Find invoked focused/skipped test chains in JS, TS and JSX/TSX source.
 * Parsing keeps comments, strings and ordinary property reads out of the check.
 * Calls and tagged templates inside template/JSX expressions are still real code.
 */
export function findFocusedTests(source, fileName = "file.test.ts") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits = [];
  const seen = new Set();
  function visit(node) {
    const callee = ts.isCallExpression(node)
      ? node.expression
      : ts.isTaggedTemplateExpression(node)
        ? node.tag
        : null;
    const chain = callee && testChain(callee);
    if (chain?.focused) {
      const start = chain.root.getStart(file);
      // A parameterized call has nested CallExpressions for the same root.
      if (!seen.has(start)) {
        seen.add(start);
        hits.push({
          line: file.getLineAndCharacterOfPosition(start).line + 1,
          snippet: chain.snippet,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return hits;
}
