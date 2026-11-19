import MathQuill from
"https://cdn.jsdelivr.net/npm/@desmos-community/mathquill@2026.8.7/dist/index.mjs";

const MQ = MathQuill.getInterface(3);

const element = document.getElementById("math-field");
const output = document.getElementById("latex-output");
const canvas = document.getElementById("01-plot");
const ctx = canvas.getContext("2d");
const plotError = document.getElementById("plot-error");

// 1. Editable MathQuill field; 2. mirror its LaTeX into the line edit
const mathField = MQ.MathField(element, {
    autoCommands: "pi sqrt",   // typing "pi" / "sqrt" becomes the symbol
    handlers: {
        edit: function() {
            output.value = mathField.latex();
        }
    }
});

const lineWidthEdit = document.getElementById("lineWidth-field");
lineWidthEdit.addEventListener('input', () => {
  const n = lineWidthEdit.valueAsNumber;
  if (Number.isNaN(n) || n < 0) return;
  ctx.lineWidth = n;
});

let lineRed = 0, lineGreen = 0, lineBlue = 0;

const lineRedEdit   = document.getElementById("lineRed-field");
const lineGreenEdit = document.getElementById("lineGreen-field");
const lineBlueEdit  = document.getElementById("lineBlue-field");

function updateLineColor() {
  const read = (edit, fallback) => {
    const n = edit.valueAsNumber;
    return Number.isNaN(n) ? fallback : Math.min(255, Math.max(0, n));
  };
  lineRed   = read(lineRedEdit, lineRed);
  lineGreen = read(lineGreenEdit, lineGreen);
  lineBlue  = read(lineBlueEdit, lineBlue);
  ctx.strokeStyle = `rgb(${lineRed} ${lineGreen} ${lineBlue})`;
}

[lineRedEdit, lineGreenEdit, lineBlueEdit].forEach(
  (edit) => edit.addEventListener("input", updateLineColor)
);
ctx.lineWidth = 5;
ctx.strokeStyle = "black";


// Plot window (change these to zoom/pan)
const xMin = 0, xMax = 1;
const yMin = 0, yMax = 1;

const plotCanvas = () => {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  plotError.textContent = "";

  let func;
  try {
    func = latexToFunction(mathField.latex());
  } catch (err) {
    plotError.textContent = err.message;
    return;
  }

  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i <= W; i++) {
    const x = xMin + (i / W) * (xMax - xMin);
    const y = func(x);
    if (!Number.isFinite(y)) { penDown = false; continue; }   // lift pen over gaps
    const py = H - ((y - yMin) / (yMax - yMin)) * H;
    penDown ? ctx.lineTo(i, py) : ctx.moveTo(i, py);
    penDown = true;
  }
  ctx.stroke();
}
// 4. Plot button -> 3. canvas
const plotButton = document.getElementById("plot-button");
plotButton.onclick = plotCanvas;


// Initial equation
mathField.latex("x^2");

// Initial output
output.value = mathField.latex();

// Automatically focus the editor
mathField.focus();




// ---- Calc: LaTeX -> function of x ----------------------------------------
// Structure based on https://stackoverflow.com/a/18499089 (Fela Maslen,
// CC BY-SA 3.0), reworked to handle MathQuill's LaTeX output.

var CALC_CONST = {
  // define your constants
  e: Math.E,
  pi: Math.PI
};

var CALC_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sec: (a) => 1 / Math.cos(a), csc: (a) => 1 / Math.sin(a), cot: (a) => 1 / Math.tan(a),
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sech: (a) => 1 / Math.cosh(a), csch: (a) => 1 / Math.sinh(a), coth: (a) => 1 / Math.tanh(a),
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log10, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil,
  neg: (a) => -a   // unary minus
};

var CALC_NUMARGS = [
  [/^(\^|\*|\/|\+|\-)$/, 2],
  [/^[a-z]+(\^[\d.]+)?$/, 1]   // functions (incl. powers like "sin^2") take one argument
];

// Names the tokenizer can recognise inside a run of letters, longest first
var CALC_NAMES = Object.keys(CALC_FUNCS).concat(Object.keys(CALC_CONST))
  .filter((n) => n !== "neg")
  .sort((a, b) => b.length - a.length);

var Calc = function(expr, infix) {
  var self = this;   // `this` is undefined inside plain callbacks in a module
  this.valid = true;
  this.error = "";
  this.expr = infix ? expr : this.latexToInfix(expr);

  // "sin^2" (from \sin^{2}x) counts as a function too
  var isFunc = (t) => t !== undefined && CALC_FUNCS.hasOwnProperty(t.split("^")[0]);

  var OpPrecedence = function(op) {
    return isFunc(op) && op !== "neg" ? 10
         : (op === "^") ? 9
         : (op === "neg") ? 8.5
         : (op === "*" || op === "/") ? 8
         : (op === "+" || op === "-") ? 7
         : 0;
  };

  var OpAssociativity = function(op) {
    return (op === "^" || isFunc(op)) ? "R" : "L";
  };

  var numArgs = function(op) {
    for (var i = 0; i < CALC_NUMARGS.length; i++) {
      if (CALC_NUMARGS[i][0].test(op)) return CALC_NUMARGS[i][1];
    }
    return false;
  };

  var fail = function(msg) {
    if (self.valid) { self.valid = false; self.error = msg; }
  };

  // --- tokenize --------------------------------------------------------------
  var raw = this.expr.match(/\d+\.?\d*|\.\d+|[a-zA-Z]+|[\^*\/+\-()]/g) || [];
  var in_tokens = [];
  raw.forEach(function(tok) {
    if (!/^[a-zA-Z]+$/.test(tok)) { in_tokens.push(tok); return; }
    // Split letter runs: "sinx" -> sin, x ; "pix" -> pi, x
    var i = 0;
    while (i < tok.length) {
      var name = CALC_NAMES.find((n) => tok.startsWith(n, i));
      if (name) { in_tokens.push(name); i += name.length; }
      else { in_tokens.push(tok[i]); i += 1; }
    }
  });

  // Fold function powers: sin ^ ( 2 ) -> "sin^2"
  for (var p = 0; p < in_tokens.length; p++) {
    if (!isFunc(in_tokens[p]) || in_tokens[p + 1] !== "^") continue;
    if (/^[\d.]+$/.test(in_tokens[p + 2] || "")) {
      in_tokens.splice(p, 3, in_tokens[p] + "^" + in_tokens[p + 2]);
    } else if (in_tokens[p + 2] === "(" && /^[\d.]+$/.test(in_tokens[p + 3] || "") && in_tokens[p + 4] === ")") {
      in_tokens.splice(p, 5, in_tokens[p] + "^" + in_tokens[p + 3]);
    }
  }

  // --- implicit multiplication and unary minus -------------------------------
  var kind = function(t) {
    if (t === undefined) return "none";
    if (t === "(") return "lp";
    if (t === ")") return "rp";
    if (/^[\^*\/+\-]$/.test(t)) return "op";
    if (isFunc(t)) return "func";
    return "value";   // number, constant or variable
  };

  var tokens = [];
  in_tokens.forEach(function(t) {
    var prev = kind(tokens[tokens.length - 1]), cur = kind(t);
    var prevIsOperandStart = prev === "none" || prev === "op" || prev === "lp" || prev === "func";

    if ((t === "-" || t === "+") && prevIsOperandStart) {
      if (t === "-") tokens.push("neg");
      return;   // unary plus is a no-op
    }
    if ((prev === "value" || prev === "rp") && (cur === "value" || cur === "func" || cur === "lp")) {
      tokens.push("*");   // 2x, x(x+1), (x+1)(x-1), 2\sin x
    }
    tokens.push(t);
  });

  // --- shunting-yard ---------------------------------------------------------
  this.rpn_expr = [];
  var rpn_expr = this.rpn_expr;
  var op_stack = [];
  var top = () => op_stack[op_stack.length - 1];

  tokens.forEach(function(token) {
    if (!self.valid) return;
    var k = kind(token);

    if (k === "value") {
      if (CALC_CONST.hasOwnProperty(token)) rpn_expr.push(["num", CALC_CONST[token]]);
      else if (token === "x") rpn_expr.push(["var", token]);
      else if (!isNaN(parseFloat(token))) rpn_expr.push(["num", parseFloat(token)]);
      else fail("Unknown symbol \"" + token + "\" (only x is a variable)");
    }
    else if (k === "func" || k === "lp") {
      op_stack.push(token);   // prefix operators never pop anything
    }
    else if (k === "rp") {
      while (op_stack.length && top() !== "(") {
        rpn_expr.push([numArgs(top()), op_stack.pop()]);
      }
      if (!op_stack.length) { fail("Unmatched )"); return; }
      op_stack.pop();   // remove the (
    }
    else {
      // Binary operator
      var tokPrec = OpPrecedence(token);
      while (op_stack.length && top() !== "(") {
        var headPrec = OpPrecedence(top());
        if (headPrec > tokPrec || (headPrec === tokPrec && OpAssociativity(token) === "L")) {
          rpn_expr.push([numArgs(top()), op_stack.pop()]);
        } else break;
      }
      op_stack.push(token);
    }
  });

  // Push all remaining operators onto the final expression
  while (self.valid && op_stack.length > 0) {
    var popped = op_stack.pop();
    if (popped === "(") { fail("Unmatched ("); break; }
    rpn_expr.push([numArgs(popped), popped]);
  }

  if (this.valid && rpn_expr.length === 0) fail("Empty expression");
  // Dry run to catch structural errors (e.g. "x+")
  if (this.valid && this.eval(1) === undefined) fail("Incomplete expression");
};


/**
 * returns the result of evaluating the current expression
 * (NaN on a math error, undefined on a malformed expression)
 */
Calc.prototype.eval = function(x) {
  var stack = [];

  for (var token of this.rpn_expr) {
    if (token[0] === "var") { stack.push(x); continue; }
    if (token[0] === "num") { stack.push(token[1]); continue; }

    // Operator
    var n = token[0], op = token[1];
    if (stack.length < n) return undefined;
    var args = stack.splice(stack.length - n, n);

    switch (op) {
      case "+": stack.push(args[0] + args[1]); break;
      case "-": stack.push(args[0] - args[1]); break;
      case "*": stack.push(args[0] * args[1]); break;
      case "/": stack.push(args[0] / args[1]); break;
      case "^": stack.push(Math.pow(args[0], args[1])); break;
      default:
        var parts = op.split("^"), fn = CALC_FUNCS[parts[0]];
        if (!fn) return undefined;
        var v = fn(args[0]);
        stack.push(parts.length > 1 ? Math.pow(v, parseFloat(parts[1])) : v);
    }
  }

  return stack.length === 1 ? stack[0] : undefined;
};

/**
 * Replace a LaTeX command with brace-delimited arguments, handling nesting,
 * e.g. \frac{\frac{1}{x}}{2}. Also accepts an optional [..] argument
 * (\sqrt[3]{x}) and single-character arguments (\frac12).
 */
function replaceBraceCommand(s, name, nArgs, build) {
  var out = "", i = 0;
  while (true) {
    var j = s.indexOf(name, i);
    if (j < 0 || /[a-zA-Z]/.test(s[j + name.length] || "")) {
      if (j < 0) return out + s.slice(i);
      out += s.slice(i, j + name.length); i = j + name.length; continue;   // e.g. \fracx-like false match
    }
    out += s.slice(i, j);
    var k = j + name.length, opt = null;
    if (s[k] === "[") {
      var e = s.indexOf("]", k);
      opt = s.slice(k + 1, e); k = e + 1;
    }
    var args = [];
    for (var a = 0; a < nArgs; a++) {
      while (s[k] === " ") k++;
      if (s[k] !== "{") { args.push(s[k] || ""); k++; continue; }
      var depth = 0, start = k;
      for (; k < s.length; k++) {
        if (s[k] === "{") depth++;
        else if (s[k] === "}" && --depth === 0) break;
      }
      args.push(s.slice(start + 1, k)); k++;
    }
    out += build(args.map((x) => replaceBraceCommand(x, name, nArgs, build)), opt);
    i = k;
  }
}

Calc.prototype.latexToInfix = function(latex) {
  /**
    * Converts MathQuill LaTeX to plain infix, e.g.
    *   \frac{1}{2}\sin\left(x\right)\cdot x^{2}  ->  ((1)/(2)) sin (x) * x^(2)
    */
  var s = latex
    .replace(/\\left|\\right/g, "")          // \left( \right) -> ( )
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\[ ,;:!]/g, " ");             // LaTeX spacing commands

  s = replaceBraceCommand(s, "\\frac", 2, (a) => "((" + a[0] + ")/(" + a[1] + "))");
  s = replaceBraceCommand(s, "\\sqrt", 1, (a, n) =>
    n === null ? "sqrt(" + a[0] + ")" : "((" + a[0] + ")^(1/(" + n + ")))");

  return s
    .replace(/\{/g, "(").replace(/\}/g, ")") // x^{2+1} -> x^(2+1)
    .replace(/\\([a-zA-Z]+)/g, " $1 ")        // \sin -> sin, \pi -> pi
    .replace(/\\/g, "");
};

function latexToFunction(latex) {
  const calc = new Calc(latex);   // parse once
  if (!calc.valid) throw new Error(calc.error);
  return (x) => calc.eval(x);     // evaluate many times
}