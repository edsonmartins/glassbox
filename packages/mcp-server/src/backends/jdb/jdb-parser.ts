import type {
  Variable,
  StackFrame,
  ThreadInfo,
  EvalResult,
  InspectResult,
  SourceLine,
  ClassInfo,
  MethodInfo,
} from '../types.js';

// ── Async Event Patterns (from RFC-002) ──────────────────────────

const ASYNC_PATTERNS = {
  breakpointHit: /^Breakpoint hit: "thread=(.+?)",\s*(.+?)\.(\w+)\(\),\s*line=(\d+)/,
  exceptionCaught: /^Exception occurred: (.+?) \(to be caught at: (.+?)\)/,
  exceptionUncaught: /^Exception occurred: (.+?) \(uncaught\)/,
  threadStarted: /^Thread (.+?) started/,
  threadDied: /^Thread (.+?) died/,
  vmDisconnected: /^The application has been disconnected/,
  vmDeath: /^The application exited/,
  stepCompleted: /^Step completed: "thread=(.+?)",\s*(.+?)\.(\w+)\(\),\s*line=(\d+)/,
} as const;

// ── parseAsyncEvent ──────────────────────────────────────────────

/**
 * Attempt to parse a single line of JDB output as an async event.
 * Returns null if the line does not match any known async event pattern.
 */
export function parseAsyncEvent(
  line: string,
): { type: string; data: Record<string, unknown> } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let match: RegExpMatchArray | null;

  match = trimmed.match(ASYNC_PATTERNS.breakpointHit);
  if (match) {
    return {
      type: 'breakpoint_hit',
      data: {
        thread: match[1],
        class: match[2],
        method: match[3],
        line: parseInt(match[4], 10),
      },
    };
  }

  match = trimmed.match(ASYNC_PATTERNS.stepCompleted);
  if (match) {
    return {
      type: 'step_completed',
      data: {
        thread: match[1],
        class: match[2],
        method: match[3],
        line: parseInt(match[4], 10),
      },
    };
  }

  match = trimmed.match(ASYNC_PATTERNS.exceptionCaught);
  if (match) {
    return {
      type: 'exception_caught',
      data: {
        exceptionType: match[1],
        caughtAt: match[2],
        isCaught: true,
      },
    };
  }

  match = trimmed.match(ASYNC_PATTERNS.exceptionUncaught);
  if (match) {
    return {
      type: 'exception_uncaught',
      data: {
        exceptionType: match[1],
        isCaught: false,
      },
    };
  }

  match = trimmed.match(ASYNC_PATTERNS.threadStarted);
  if (match) {
    return {
      type: 'thread_started',
      data: { thread: match[1] },
    };
  }

  match = trimmed.match(ASYNC_PATTERNS.threadDied);
  if (match) {
    return {
      type: 'thread_died',
      data: { thread: match[1] },
    };
  }

  if (ASYNC_PATTERNS.vmDisconnected.test(trimmed)) {
    return {
      type: 'vm_disconnected',
      data: {},
    };
  }

  if (ASYNC_PATTERNS.vmDeath.test(trimmed)) {
    return {
      type: 'vm_death',
      data: {},
    };
  }

  return null;
}

// ── parseLocals ──────────────────────────────────────────────────

/**
 * Parse JDB `locals` command output into Variable[].
 *
 * JDB output example:
 * ```
 * Method arguments:
 *   dto = instance of com.example.PedidoDTO(id=338)
 * Local variables:
 *   cliente = null
 *   nome = <not yet computed>
 * ```
 */
export function parseLocals(output: string): Variable[] {
  const variables: Variable[] = [];
  if (!output || !output.trim()) return variables;

  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip section headers and empty lines
    if (
      !trimmed ||
      trimmed === 'Method arguments:' ||
      trimmed === 'Local variables:' ||
      trimmed.startsWith('No local variables') ||
      trimmed.startsWith('No method arguments')
    ) {
      continue;
    }

    // Pattern: "name = value"
    const eqIndex = trimmed.indexOf(' = ');
    if (eqIndex === -1) continue;

    const name = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 3).trim();

    let type = 'unknown';
    let value = rawValue;
    let isNull = false;
    let expandable = false;
    let alert: boolean | undefined;

    if (rawValue === 'null') {
      isNull = true;
      value = 'null';
      alert = true;
    } else if (rawValue === '<not yet computed>') {
      value = '<not yet computed>';
      alert = true;
    } else {
      // "instance of com.example.Type(id=NNN)"
      const instanceMatch = rawValue.match(
        /^instance of (.+?)\(id=\d+\)$/,
      );
      if (instanceMatch) {
        type = instanceMatch[1];
        value = rawValue;
        expandable = true;
      } else if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        // String literal
        type = 'java.lang.String';
        value = rawValue;
      } else if (/^\d+$/.test(rawValue)) {
        type = 'int';
        value = rawValue;
      } else if (/^\d+\.\d+$/.test(rawValue)) {
        type = 'double';
        value = rawValue;
      } else if (rawValue === 'true' || rawValue === 'false') {
        type = 'boolean';
        value = rawValue;
      } else {
        value = rawValue;
      }
    }

    const variable: Variable = { name, type, value, isNull, expandable };
    if (alert !== undefined) {
      variable.alert = alert;
    }
    variables.push(variable);
  }

  return variables;
}

// ── parseStacktrace ──────────────────────────────────────────────

/**
 * Parse JDB `where` command output into StackFrame[].
 *
 * JDB output example:
 * ```
 *   [1] com.example.PedidoService.criarPedido (PedidoService.java:47)
 *   [2] java.lang.reflect.Method.invoke0 (native method)
 *   [3] java.lang.reflect.Method.invoke (Method.java:77)
 * ```
 */
export function parseStacktrace(output: string): StackFrame[] {
  const frames: StackFrame[] = [];
  if (!output || !output.trim()) return frames;

  const lines = output.split('\n');

  // Pattern: [N] fully.qualified.Class.method (File.java:line)
  //      or: [N] fully.qualified.Class.method (native method)
  const frameRe =
    /\[(\d+)\]\s+(.+?)\.(\w+)\s+\((.+?)\)/;

  for (const line of lines) {
    const match = line.match(frameRe);
    if (!match) continue;

    const index = parseInt(match[1], 10);
    const className = match[2];
    const method = match[3];
    const locationStr = match[4]; // "File.java:47" or "native method"

    let file: string | null = null;
    let lineNum = -1;

    if (locationStr === 'native method') {
      file = null;
      lineNum = -1;
    } else {
      const colonIdx = locationStr.lastIndexOf(':');
      if (colonIdx !== -1) {
        file = locationStr.slice(0, colonIdx);
        lineNum = parseInt(locationStr.slice(colonIdx + 1), 10);
      } else {
        file = locationStr;
      }
    }

    // Heuristic: JDK / framework classes are not "user code"
    const isUserCode = !(
      className.startsWith('java.') ||
      className.startsWith('javax.') ||
      className.startsWith('jdk.') ||
      className.startsWith('sun.') ||
      className.startsWith('com.sun.') ||
      className.startsWith('org.springframework.') ||
      className.startsWith('org.apache.') ||
      className.startsWith('org.hibernate.')
    );

    frames.push({
      index,
      class: className,
      method,
      file,
      line: lineNum,
      isUserCode,
    });
  }

  return frames;
}

// ── parseThreads ─────────────────────────────────────────────────

/**
 * Parse JDB `threads` command output into ThreadInfo[].
 *
 * JDB output example:
 * ```
 * Group system:
 *   (java.lang.ref.Reference$ReferenceHandler)0xa Reference Handler cond. waiting
 * Group main:
 *   (java.lang.Thread)0x1    main                          running
 *   (java.lang.Thread)0xb    http-nio-8080-exec-1          sleeping
 * ```
 */
export function parseThreads(output: string): ThreadInfo[] {
  const threads: ThreadInfo[] = [];
  if (!output || !output.trim()) return threads;

  const lines = output.split('\n');
  let currentGroup = '';

  // Pattern: (type)0xHEX  name  state
  const threadRe =
    /^\s+\((.+?)\)(0x[\da-fA-F]+)\s+(.+?)\s{2,}(.+)$/;

  for (const line of lines) {
    // Detect group headers
    const groupMatch = line.match(/^Group\s+(.+?):$/);
    if (groupMatch) {
      currentGroup = groupMatch[1];
      continue;
    }

    const match = line.match(threadRe);
    if (!match) continue;

    const id = match[2]; // hex id like "0x1"
    const name = match[3].trim();
    const state = match[4].trim();

    const isSuspended =
      state === 'suspended' ||
      state.includes('at breakpoint') ||
      state.includes('suspended');

    const isDaemon =
      currentGroup === 'system' ||
      name.includes('Daemon') ||
      name.includes('GC') ||
      name.includes('Finalizer');

    threads.push({
      id,
      name,
      state,
      isSuspended,
      isDaemon,
    });
  }

  return threads;
}

// ── parseEval ────────────────────────────────────────────────────

/**
 * Parse JDB `eval` command output into EvalResult.
 *
 * JDB output examples:
 * - `expr = value`
 * - `expr = instance of com.example.Type(id=N)`
 * - `expr = null`
 * - `expr = "some string"`
 */
export function parseEval(output: string): EvalResult {
  const trimmed = (output ?? '').trim();

  // Default for unparseable output
  const fallback: EvalResult = {
    expression: '',
    type: 'unknown',
    value: trimmed,
    isNull: false,
  };

  if (!trimmed) return fallback;

  // Find the first " = " separator
  const eqIndex = trimmed.indexOf(' = ');
  if (eqIndex === -1) {
    return { ...fallback, expression: trimmed };
  }

  const expression = trimmed.slice(0, eqIndex).trim();
  const rawValue = trimmed.slice(eqIndex + 3).trim();

  let type = 'unknown';
  let value = rawValue;
  let isNull = false;

  if (rawValue === 'null') {
    isNull = true;
    value = 'null';
  } else {
    const instanceMatch = rawValue.match(/^instance of (.+?)\(id=\d+\)$/);
    if (instanceMatch) {
      type = instanceMatch[1];
    } else if (rawValue.startsWith('"')) {
      type = 'java.lang.String';
    } else if (/^-?\d+$/.test(rawValue)) {
      type = 'int';
    } else if (/^-?\d+\.\d+$/.test(rawValue)) {
      type = 'double';
    } else if (rawValue === 'true' || rawValue === 'false') {
      type = 'boolean';
    }
  }

  return { expression, type, value, isNull };
}

// ── parsePrint ───────────────────────────────────────────────────

/**
 * Parse JDB `print` or `dump` command output into InspectResult.
 *
 * Output is similar to eval but may include multi-line field details for `dump`.
 */
export function parsePrint(output: string): InspectResult {
  const trimmed = (output ?? '').trim();

  const fallback: InspectResult = {
    expression: '',
    type: 'unknown',
    value: trimmed,
  };

  if (!trimmed) return fallback;

  // First line contains "expr = value" or "expr = instance of Type(id=N)"
  const lines = trimmed.split('\n');
  const firstLine = lines[0].trim();

  const eqIndex = firstLine.indexOf(' = ');
  if (eqIndex === -1) {
    return { ...fallback, expression: firstLine };
  }

  const expression = firstLine.slice(0, eqIndex).trim();
  const rawValue = firstLine.slice(eqIndex + 3).trim();

  let type = 'unknown';

  const instanceMatch = rawValue.match(/^instance of (.+?)\(id=\d+\)$/);
  if (instanceMatch) {
    type = instanceMatch[1];
  } else if (rawValue === 'null') {
    type = 'null';
  } else if (rawValue.startsWith('"')) {
    type = 'java.lang.String';
  }

  // For dump output, the value includes all remaining lines (field details)
  let value: unknown;
  if (lines.length > 1) {
    // Multi-line: parse fields into an object
    const fields: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const fieldLine = lines[i].trim();
      if (!fieldLine) continue;
      const fieldEq = fieldLine.indexOf(' = ');
      if (fieldEq !== -1) {
        const fieldName = fieldLine.slice(0, fieldEq).trim();
        const fieldValue = fieldLine.slice(fieldEq + 3).trim();
        fields[fieldName] = fieldValue;
      }
    }
    value = Object.keys(fields).length > 0 ? fields : rawValue;
  } else {
    value = rawValue;
  }

  return { expression, type, value };
}

// ── parseList ────────────────────────────────────────────────────

/**
 * Parse JDB `list` command output into SourceLine[].
 *
 * JDB output example:
 * ```
 * 42        log.info("Criando pedido: {}", dto.getClienteId());
 * 43        Cliente cliente = clienteRepo
 * 44            .findById(dto.getClienteId())
 * 45 =>         .orElse(null);
 * ```
 *
 * The current execution line is marked with `=>`.
 */
export function parseList(output: string): SourceLine[] {
  const lines: SourceLine[] = [];
  if (!output || !output.trim()) return lines;

  const rawLines = output.split('\n');

  // Pattern: optional spaces, line number, optional "=>", then the code text
  // JDB format: "   45 =>     .orElse(null);"  or  "   42       code here"
  const lineRe = /^(\d+)\s*(=>)?\s(.*)$/;

  for (const raw of rawLines) {
    // Trim only leading whitespace up to the line number
    const trimmed = raw.trimStart();
    const match = trimmed.match(lineRe);
    if (!match) continue;

    const lineNum = parseInt(match[1], 10);
    const isCurrent = match[2] === '=>';
    const text = match[3];

    lines.push({
      n: lineNum,
      text,
      ...(isCurrent ? { isCurrent: true } : {}),
    });
  }

  return lines;
}

// ── parseBreakpointSet ───────────────────────────────────────────

/**
 * Parse JDB breakpoint-set confirmation.
 *
 * JDB output: `Set breakpoint com.example.PedidoService:47`
 *
 * Also handles deferred breakpoints:
 *   `Deferring breakpoint com.example.PedidoService:47.`
 *   `It will be set after the class is loaded.`
 */
export function parseBreakpointSet(
  output: string,
): { class: string; line: number } {
  const trimmed = (output ?? '').trim();

  // "Set breakpoint com.example.Class:NN"
  const setMatch = trimmed.match(
    /^Set breakpoint\s+(.+):(\d+)/m,
  );
  if (setMatch) {
    return {
      class: setMatch[1],
      line: parseInt(setMatch[2], 10),
    };
  }

  // "Deferring breakpoint com.example.Class:NN"
  const deferMatch = trimmed.match(
    /^Deferring breakpoint\s+(.+):(\d+)/m,
  );
  if (deferMatch) {
    return {
      class: deferMatch[1],
      line: parseInt(deferMatch[2], 10),
    };
  }

  // Fallback: try to find any "Class:NN" pattern
  const fallbackMatch = trimmed.match(/([a-zA-Z_][\w.]*[\w]):(\d+)/);
  if (fallbackMatch) {
    return {
      class: fallbackMatch[1],
      line: parseInt(fallbackMatch[2], 10),
    };
  }

  throw new Error(`Could not parse breakpoint output: "${trimmed}"`);
}

// ── parseClasses ──────────────────────────────────────────────────

/**
 * Parse JDB `classes` command output into ClassInfo[].
 *
 * JDB output example:
 * ```
 * ** classes list **
 * com.example.PedidoService
 * com.example.dto.PedidoDTO
 * java.lang.String
 * interface java.io.Serializable
 * ```
 *
 * Lines prefixed with "interface " indicate interfaces.
 */
export function parseClasses(output: string): ClassInfo[] {
  const classes: ClassInfo[] = [];
  if (!output || !output.trim()) return classes;

  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and JDB headers
    if (
      !trimmed ||
      trimmed.startsWith('**') ||
      trimmed.startsWith('>') ||
      trimmed === 'classes'
    ) {
      continue;
    }

    // "interface com.example.SomeInterface"
    if (trimmed.startsWith('interface ')) {
      const name = trimmed.slice('interface '.length).trim();
      if (name) {
        classes.push({ name, isInterface: true });
      }
    } else {
      // Regular class name — one per line
      // Skip lines that don't look like class names
      if (/^[a-zA-Z_$][\w.$]*$/.test(trimmed)) {
        classes.push({ name: trimmed });
      }
    }
  }

  return classes;
}

// ── parseMethods ──────────────────────────────────────────────────

/**
 * Parse JDB `methods <class>` command output into MethodInfo[].
 *
 * JDB output example:
 * ```
 * ** methods list **
 * com.example.PedidoService criarPedido(com.example.dto.PedidoDTO)
 * com.example.PedidoService <init>()
 * com.example.PedidoService main(java.lang.String[])
 * ```
 *
 * Each line: ClassName methodName(paramTypes)
 */
export function parseMethods(output: string): MethodInfo[] {
  const methods: MethodInfo[] = [];
  if (!output || !output.trim()) return methods;

  const lines = output.split('\n');

  // Pattern: ClassName methodName(params)  or  ClassName methodName(params) returnType
  const methodRe = /^([\w.$]+)\s+(\S+)\(([^)]*)\)(.*)$/;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and JDB headers
    if (
      !trimmed ||
      trimmed.startsWith('**') ||
      trimmed.startsWith('>') ||
      trimmed === 'methods'
    ) {
      continue;
    }

    const match = trimmed.match(methodRe);
    if (match) {
      const methodName = match[2];
      const params = match[3];
      const signature = `${methodName}(${params})`;

      methods.push({
        name: methodName,
        signature,
      });
    }
  }

  return methods;
}
