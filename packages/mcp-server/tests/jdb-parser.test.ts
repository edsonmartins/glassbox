import { describe, it, expect } from 'vitest';
import {
  parseLocals,
  parseStacktrace,
  parseThreads,
  parseEval,
  parsePrint,
  parseList,
  parseBreakpointSet,
  parseAsyncEvent,
  parseClasses,
  parseMethods,
} from '../src/backends/jdb/jdb-parser.js';

// ── parseLocals ───────────────────────────────────────────────────

describe('parseLocals', () => {
  it('parses method arguments and local variables', () => {
    const input = [
      'Method arguments:',
      '  dto = instance of com.example.PedidoDTO(id=338)',
      'Local variables:',
      '  cliente = null',
      '  nome = "Alice"',
      '  count = 42',
    ].join('\n');

    const vars = parseLocals(input);
    expect(vars).toHaveLength(4);

    expect(vars[0]).toMatchObject({
      name: 'dto',
      type: 'com.example.PedidoDTO',
      expandable: true,
      isNull: false,
    });

    expect(vars[1]).toMatchObject({
      name: 'cliente',
      isNull: true,
      alert: true,
    });

    expect(vars[2]).toMatchObject({
      name: 'nome',
      type: 'java.lang.String',
      value: '"Alice"',
    });

    expect(vars[3]).toMatchObject({
      name: 'count',
      type: 'int',
      value: '42',
    });
  });

  it('returns empty array for empty output', () => {
    expect(parseLocals('')).toEqual([]);
    expect(parseLocals('   ')).toEqual([]);
  });

  it('marks <not yet computed> variables as alert', () => {
    const vars = parseLocals('Local variables:\n  x = <not yet computed>');
    expect(vars[0].alert).toBe(true);
  });

  it('parses boolean variables', () => {
    const vars = parseLocals('Local variables:\n  active = true');
    expect(vars[0]).toMatchObject({ name: 'active', type: 'boolean', value: 'true' });
  });

  it('parses double variables', () => {
    const vars = parseLocals('Local variables:\n  price = 19.99');
    expect(vars[0]).toMatchObject({ name: 'price', type: 'double', value: '19.99' });
  });

  it('skips "No local variables" and "No method arguments"', () => {
    const input = 'Method arguments:\nNo method arguments\nLocal variables:\nNo local variables';
    expect(parseLocals(input)).toEqual([]);
  });
});

// ── parseStacktrace ───────────────────────────────────────────────

describe('parseStacktrace', () => {
  it('parses a typical JDB where output', () => {
    const input = [
      '  [1] com.example.PedidoService.criarPedido (PedidoService.java:47)',
      '  [2] java.lang.reflect.Method.invoke (Method.java:77)',
      '  [3] sun.reflect.NativeMethodAccessorImpl.invoke0 (native method)',
    ].join('\n');

    const frames = parseStacktrace(input);
    expect(frames).toHaveLength(3);

    expect(frames[0]).toMatchObject({
      index: 1,
      class: 'com.example.PedidoService',
      method: 'criarPedido',
      file: 'PedidoService.java',
      line: 47,
      isUserCode: true,
    });

    expect(frames[1]).toMatchObject({
      class: 'java.lang.reflect.Method',
      isUserCode: false,
    });

    expect(frames[2]).toMatchObject({
      file: null,
      line: -1,
    });
  });

  it('returns empty array for empty input', () => {
    expect(parseStacktrace('')).toEqual([]);
  });

  it('identifies framework classes as non-user code', () => {
    const input = '  [1] org.springframework.web.DispatcherServlet.doDispatch (DispatcherServlet.java:100)';
    const frames = parseStacktrace(input);
    expect(frames[0].isUserCode).toBe(false);
  });
});

// ── parseThreads ──────────────────────────────────────────────────

describe('parseThreads', () => {
  it('parses thread groups and thread entries', () => {
    const input = [
      'Group system:',
      '  (java.lang.ref.Reference$ReferenceHandler)0xa  Reference Handler     cond. waiting',
      'Group main:',
      '  (java.lang.Thread)0x1  main                          running',
    ].join('\n');

    const threads = parseThreads(input);
    expect(threads).toHaveLength(2);

    expect(threads[0]).toMatchObject({
      id: '0xa',
      name: 'Reference Handler',
      isDaemon: true,
    });

    expect(threads[1]).toMatchObject({
      id: '0x1',
      name: 'main',
      state: 'running',
      isSuspended: false,
    });
  });

  it('marks suspended threads correctly', () => {
    const input = [
      'Group main:',
      '  (java.lang.Thread)0x1  main                          suspended',
    ].join('\n');
    const threads = parseThreads(input);
    expect(threads[0].isSuspended).toBe(true);
  });

  it('returns empty array for empty input', () => {
    expect(parseThreads('')).toEqual([]);
  });
});

// ── parseEval ─────────────────────────────────────────────────────

describe('parseEval', () => {
  it('parses a simple int eval', () => {
    const result = parseEval('count = 42');
    expect(result).toMatchObject({
      expression: 'count',
      type: 'int',
      value: '42',
      isNull: false,
    });
  });

  it('parses a null result', () => {
    const result = parseEval('obj = null');
    expect(result).toMatchObject({ isNull: true, value: 'null' });
  });

  it('parses an instance eval', () => {
    const result = parseEval('svc = instance of com.example.PedidoService(id=12)');
    expect(result).toMatchObject({
      expression: 'svc',
      type: 'com.example.PedidoService',
    });
  });

  it('parses a boolean', () => {
    const result = parseEval('active = true');
    expect(result).toMatchObject({ type: 'boolean', value: 'true' });
  });

  it('parses a string', () => {
    const result = parseEval('name = "Alice"');
    expect(result).toMatchObject({ type: 'java.lang.String' });
  });

  it('returns fallback for empty input', () => {
    const result = parseEval('');
    expect(result.type).toBe('unknown');
  });
});

// ── parsePrint ────────────────────────────────────────────────────

describe('parsePrint', () => {
  it('parses single-line dump output', () => {
    const result = parsePrint('nome = "Alice"');
    expect(result).toMatchObject({
      expression: 'nome',
      type: 'java.lang.String',
      value: '"Alice"',
    });
  });

  it('parses multi-line dump with fields', () => {
    const input = [
      'pedido = instance of com.example.Pedido(id=5)',
      '  id = 5',
      '  clienteId = 100',
    ].join('\n');

    const result = parsePrint(input);
    expect(result.type).toBe('com.example.Pedido');
    expect(result.value).toMatchObject({ id: '5', clienteId: '100' });
  });

  it('parses null dump', () => {
    const result = parsePrint('x = null');
    expect(result.type).toBe('null');
  });

  it('returns fallback for empty input', () => {
    const result = parsePrint('');
    expect(result.type).toBe('unknown');
  });
});

// ── parseList ─────────────────────────────────────────────────────

describe('parseList', () => {
  it('parses JDB list output with current line marker', () => {
    const input = [
      '42    log.info("Creating order");',
      '43    Cliente cliente = clienteRepo',
      '44        .findById(dto.getClienteId())',
      '45 =>     .orElse(null);',
      '46    if (cliente == null) {',
    ].join('\n');

    const lines = parseList(input);
    expect(lines).toHaveLength(5);
    expect(lines[3]).toMatchObject({ n: 45, isCurrent: true });
    expect(lines[0].isCurrent).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(parseList('')).toEqual([]);
  });
});

// ── parseBreakpointSet ────────────────────────────────────────────

describe('parseBreakpointSet', () => {
  it('parses a Set breakpoint confirmation', () => {
    const result = parseBreakpointSet('Set breakpoint com.example.PedidoService:47');
    expect(result).toEqual({ class: 'com.example.PedidoService', line: 47 });
  });

  it('parses a Deferring breakpoint confirmation', () => {
    const result = parseBreakpointSet(
      'Deferring breakpoint com.example.PedidoService:47.\nIt will be set after the class is loaded.',
    );
    expect(result).toEqual({ class: 'com.example.PedidoService', line: 47 });
  });

  it('throws for unparseable output', () => {
    expect(() => parseBreakpointSet('something unrecognized')).toThrow();
  });
});

// ── parseAsyncEvent ───────────────────────────────────────────────

describe('parseAsyncEvent', () => {
  it('parses breakpoint_hit', () => {
    const ev = parseAsyncEvent(
      'Breakpoint hit: "thread=main", com.example.PedidoService.criarPedido(), line=47',
    );
    expect(ev).toMatchObject({
      type: 'breakpoint_hit',
      data: { thread: 'main', class: 'com.example.PedidoService', method: 'criarPedido', line: 47 },
    });
  });

  it('parses step_completed', () => {
    const ev = parseAsyncEvent(
      'Step completed: "thread=main", com.example.PedidoService.processOrder(), line=52',
    );
    expect(ev).toMatchObject({ type: 'step_completed' });
  });

  it('parses exception_caught', () => {
    const ev = parseAsyncEvent(
      'Exception occurred: java.lang.NullPointerException (to be caught at: com.example.Handler.handle())',
    );
    expect(ev).toMatchObject({
      type: 'exception_caught',
      data: { exceptionType: 'java.lang.NullPointerException', isCaught: true },
    });
  });

  it('parses exception_uncaught', () => {
    const ev = parseAsyncEvent(
      'Exception occurred: java.lang.RuntimeException (uncaught)',
    );
    expect(ev).toMatchObject({
      type: 'exception_uncaught',
      data: { isCaught: false },
    });
  });

  it('parses thread_started', () => {
    const ev = parseAsyncEvent('Thread http-nio-8080-exec-1 started');
    expect(ev).toMatchObject({ type: 'thread_started', data: { thread: 'http-nio-8080-exec-1' } });
  });

  it('parses thread_died', () => {
    const ev = parseAsyncEvent('Thread http-nio-8080-exec-1 died');
    expect(ev).toMatchObject({ type: 'thread_died', data: { thread: 'http-nio-8080-exec-1' } });
  });

  it('parses vm_disconnected', () => {
    const ev = parseAsyncEvent('The application has been disconnected');
    expect(ev).toMatchObject({ type: 'vm_disconnected' });
  });

  it('parses vm_death', () => {
    const ev = parseAsyncEvent('The application exited');
    expect(ev).toMatchObject({ type: 'vm_death' });
  });

  it('returns null for unrecognized lines', () => {
    expect(parseAsyncEvent('  [1] some.Class.method (File.java:10)')).toBeNull();
    expect(parseAsyncEvent('')).toBeNull();
  });
});

// ── parseClasses ────────────────────────────────────────────────────

describe('parseClasses', () => {
  it('parses regular classes', () => {
    const output = [
      '** classes list **',
      'com.example.PedidoService',
      'com.example.dto.PedidoDTO',
      'java.lang.String',
    ].join('\n');

    const classes = parseClasses(output);
    expect(classes).toHaveLength(3);
    expect(classes[0]).toEqual({ name: 'com.example.PedidoService' });
    expect(classes[1]).toEqual({ name: 'com.example.dto.PedidoDTO' });
    expect(classes[2]).toEqual({ name: 'java.lang.String' });
  });

  it('detects interfaces', () => {
    const output = [
      'interface java.io.Serializable',
      'com.example.MyClass',
      'interface com.example.MyInterface',
    ].join('\n');

    const classes = parseClasses(output);
    expect(classes).toHaveLength(3);
    expect(classes[0]).toEqual({ name: 'java.io.Serializable', isInterface: true });
    expect(classes[1]).toEqual({ name: 'com.example.MyClass' });
    expect(classes[2]).toEqual({ name: 'com.example.MyInterface', isInterface: true });
  });

  it('returns empty for empty output', () => {
    expect(parseClasses('')).toEqual([]);
    expect(parseClasses('   ')).toEqual([]);
  });

  it('skips JDB prompt and header lines', () => {
    const output = '> ** classes list **\n> \ncom.example.Foo\n>';
    const classes = parseClasses(output);
    expect(classes).toHaveLength(1);
    expect(classes[0].name).toBe('com.example.Foo');
  });
});

// ── parseMethods ────────────────────────────────────────────────────

describe('parseMethods', () => {
  it('parses method signatures', () => {
    const output = [
      '** methods list **',
      'com.example.PedidoService criarPedido(com.example.dto.PedidoDTO)',
      'com.example.PedidoService <init>()',
      'com.example.PedidoService main(java.lang.String[])',
    ].join('\n');

    const methods = parseMethods(output);
    expect(methods).toHaveLength(3);
    expect(methods[0]).toEqual({
      name: 'criarPedido',
      signature: 'criarPedido(com.example.dto.PedidoDTO)',
    });
    expect(methods[1]).toEqual({
      name: '<init>',
      signature: '<init>()',
    });
    expect(methods[2]).toEqual({
      name: 'main',
      signature: 'main(java.lang.String[])',
    });
  });

  it('returns empty for empty output', () => {
    expect(parseMethods('')).toEqual([]);
  });

  it('skips JDB headers', () => {
    const output = '** methods list **\n> \n';
    const methods = parseMethods(output);
    expect(methods).toEqual([]);
  });
});
