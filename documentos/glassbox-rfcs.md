# Glassbox — Request for Comments (RFCs)

**Projeto:** Glassbox — Debug Inteligente para JVM via MCP
**Autor:** EDSON — IntegrAllTech
**Data:** Fevereiro 2026
**Status:** Draft

---

## Índice

- [RFC-001: MCP Tools — API Completa](#rfc-001)
- [RFC-002: JDB Backend — Protocolo de Comunicação](#rfc-002)
- [RFC-003: Event Stream — Protocolo e Tipagem](#rfc-003)
- [RFC-004: TUI — Layout, Painéis e Interação](#rfc-004)
- [RFC-005: Controle de Turno — IA vs Desenvolvedor](#rfc-005)
- [RFC-006: Ciclo de Vida de uma Sessão de Debug](#rfc-006)

---

<a id="rfc-001"></a>
## RFC-001: MCP Tools — API Completa

### Resumo

Define todas as MCP tools que o Glassbox expõe para a IA. Cada tool é uma operação atômica de debug com input JSON e output JSON.

### Princípios de Design

1. **Uma tool = uma ação** — sem side effects ocultos
2. **Output estruturado** — sempre JSON parseável pela IA
3. **Fail-fast** — erros claros com `error_code` e `message`
4. **Idempotência onde possível** — set breakpoint 2x = 1 breakpoint
5. **Mínimo de tokens** — output conciso, sem informação desnecessária

### Catálogo de Tools

#### 1. Lifecycle

##### `debug/launch`

Compila e inicia o projeto Java com agent de debug JDWP.

```typescript
// Input
{
  name: "debug/launch",
  arguments: {
    project_dir: string;       // Diretório raiz do projeto
    build_tool: "maven" | "gradle" | "manual";
    main_class?: string;       // Auto-detectado se não fornecido
    jvm_args?: string[];       // Args adicionais da JVM
    app_args?: string[];       // Args da aplicação
    port?: number;             // Porta JDWP (default: 5005)
    suspend?: boolean;         // Suspender até attach (default: true)
  }
}

// Output (sucesso)
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "launched",
      pid: 12345,
      jdwp_port: 5005,
      main_class: "com.example.Application",
      jdk_version: "17.0.9",
      build_tool: "maven",
      classpath_entries: 47
    })
  }]
}

// Output (erro)
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "error",
      error_code: "BUILD_FAILED",
      message: "Maven build failed: compilation error in PedidoService.java:23",
      details: "cannot find symbol: class ClienteNotFoundException"
    })
  }],
  isError: true
}
```

**Comportamento:**
1. Detecta build tool (pom.xml → Maven, build.gradle → Gradle)
2. Compila o projeto com flag de debug (`-g`)
3. Inicia a JVM com `-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=*:5005`
4. Conecta JDB na porta JDWP
5. Emite evento `session_started`

##### `debug/attach`

Conecta em processo Java já rodando com JDWP habilitado.

```typescript
// Input
{
  name: "debug/attach",
  arguments: {
    host?: string;     // default: "localhost"
    port: number;      // Porta JDWP
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "attached",
      pid: 12345,
      jdk_version: "17.0.9",
      threads: 8,
      loaded_classes: 1247
    })
  }]
}
```

##### `debug/disconnect`

Encerra sessão de debug e opcionalmente mata o processo.

```typescript
// Input
{
  name: "debug/disconnect",
  arguments: {
    terminate?: boolean;  // Matar processo? (default: false)
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "disconnected",
      session_duration_ms: 15234,
      total_events: 42,
      total_tokens: 134
    })
  }]
}
```

---

#### 2. Execution Control

##### `debug/continue`

Resume execução até próximo breakpoint ou exceção.

```typescript
// Input
{
  name: "debug/continue",
  arguments: {
    thread_id?: string;  // Se omitido, resume todas as threads
  }
}

// Output (breakpoint atingido)
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "stopped",
      reason: "breakpoint_hit" | "exception_caught" | "step_completed",
      location: {
        file: "PedidoService.java",
        line: 47,
        class: "com.example.PedidoService",
        method: "criarPedido"
      },
      thread: "http-nio-8080-exec-1",
      // Se exception:
      exception?: {
        type: "java.lang.NullPointerException",
        message: null
      }
    })
  }]
}
```

##### `debug/step_over`

Executa a linha atual e para na próxima (sem entrar em métodos).

```typescript
// Input
{
  name: "debug/step_over",
  arguments: {
    thread_id: string;
  }
}
// Output: mesmo formato de debug/continue
```

##### `debug/step_into`

Entra no método chamado na linha atual.

```typescript
// Input
{
  name: "debug/step_into",
  arguments: {
    thread_id: string;
    filter_jdk?: boolean;  // Pular classes java.* (default: true)
  }
}
```

##### `debug/step_out`

Sai do método atual e para no caller.

```typescript
// Input
{
  name: "debug/step_out",
  arguments: {
    thread_id: string;
  }
}
```

---

#### 3. Breakpoints

##### `debug/breakpoint`

Set ou remove breakpoint em uma linha.

```typescript
// Input
{
  name: "debug/breakpoint",
  arguments: {
    file: string;       // "PedidoService.java" ou FQCN
    line: number;
    action: "set" | "remove";   // default: "set"
    condition?: string;          // Expressão Java (break só se true)
    hit_count?: number;          // Break após N hits
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "set" | "removed",
      id: "bp-1",
      file: "com/example/PedidoService.java",
      line: 47,
      condition: null,
      hit_count: 0
    })
  }]
}
```

##### `debug/catch`

Configura breakpoint em exceção (para quando exceção é lançada).

```typescript
// Input
{
  name: "debug/catch",
  arguments: {
    exception_class: string;  // "NullPointerException" ou FQCN
    caught?: boolean;          // Parar em caught? (default: true)
    uncaught?: boolean;        // Parar em uncaught? (default: true)
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      status: "set",
      exception: "java.lang.NullPointerException",
      caught: true,
      uncaught: true
    })
  }]
}
```

---

#### 4. Inspection

##### `debug/locals`

Retorna todas as variáveis locais do frame atual.

```typescript
// Input
{
  name: "debug/locals",
  arguments: {
    thread_id: string;
    frame_index?: number;   // default: 0 (frame mais recente)
    max_depth?: number;     // Profundidade de expansão de objetos (default: 1)
    max_elements?: number;  // Máximo de elementos em arrays/collections (default: 10)
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      frame: {
        method: "criarPedido",
        file: "PedidoService.java",
        line: 47
      },
      variables: [
        {
          name: "dto",
          type: "com.example.PedidoDTO",
          value: "{clienteId=999, itens=ArrayList(3)}",
          is_null: false,
          expandable: true
        },
        {
          name: "cliente",
          type: "com.example.Cliente",
          value: "null",
          is_null: true,
          expandable: false,
          alert: true  // ⚠️ flag para a IA e TUI
        }
      ]
    })
  }]
}
```

##### `debug/inspect`

Inspeciona uma variável ou campo em profundidade.

```typescript
// Input
{
  name: "debug/inspect",
  arguments: {
    expression: string;        // "dto", "dto.itens", "dto.getClienteId()"
    thread_id: string;
    frame_index?: number;
    max_depth?: number;        // default: 2
    max_string_length?: number; // Truncar strings longas (default: 200)
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      expression: "dto",
      type: "com.example.PedidoDTO",
      value: {
        clienteId: { type: "Long", value: "999" },
        itens: {
          type: "java.util.ArrayList",
          size: 3,
          elements: [
            { type: "ItemDTO", value: "{produtoId=1, qtd=5, preco=10.50}" },
            { type: "ItemDTO", value: "{produtoId=7, qtd=2, preco=250.00}" },
            { type: "ItemDTO", value: "{produtoId=12, qtd=1, preco=782.40}" }
          ]
        },
        observacoes: { type: "String", value: "null" }
      }
    })
  }]
}
```

##### `debug/evaluate`

Avalia expressão Java arbitrária no contexto do frame atual.

```typescript
// Input
{
  name: "debug/evaluate",
  arguments: {
    expression: string;    // Qualquer expressão Java válida
    thread_id: string;
    frame_index?: number;
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      expression: "clienteRepo.findById(999)",
      type: "java.util.Optional",
      value: "Optional.empty",
      is_null: false
    })
  }]
}
```

**Segurança:** `debug/evaluate` pode executar código arbitrário na JVM target. Isso é intencional — a IA precisa dessa capacidade para investigação. A TUI mostra cada `evaluate` no Event Log para transparência.

##### `debug/stacktrace`

Retorna o call stack de uma thread.

```typescript
// Input
{
  name: "debug/stacktrace",
  arguments: {
    thread_id: string;
    max_frames?: number;    // default: 20
    filter_jdk?: boolean;   // Omitir frames java.*/sun.* (default: false)
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      thread: "http-nio-8080-exec-1",
      frame_count: 12,
      frames: [
        { index: 0, class: "com.example.PedidoService", method: "criarPedido", file: "PedidoService.java", line: 47, is_user_code: true },
        { index: 1, class: "java.lang.reflect.Method", method: "invoke0", file: null, line: -1, is_user_code: false },
        { index: 2, class: "java.lang.reflect.Method", method: "invoke", file: "Method.java", line: 77, is_user_code: false },
        { index: 3, class: "org.springframework.web.servlet.FrameworkServlet", method: "handleRequest", file: "FrameworkServlet.java", line: 142, is_user_code: false }
      ]
    })
  }]
}
```

##### `debug/threads`

Lista todas as threads e seus estados.

```typescript
// Input
{
  name: "debug/threads",
  arguments: {
    include_daemon?: boolean;  // default: true
    include_system?: boolean;  // default: false
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      total: 8,
      threads: [
        { id: "1", name: "http-nio-8080-exec-1", state: "BREAKPOINT", is_suspended: true, frame_count: 12 },
        { id: "2", name: "http-nio-8080-exec-2", state: "RUNNING", is_suspended: false },
        { id: "3", name: "main", state: "WAITING", is_suspended: false },
        { id: "4", name: "GC Thread#0", state: "RUNNING", is_daemon: true }
      ]
    })
  }]
}
```

---

#### 5. Source Code

##### `debug/source`

Retorna trecho de código-fonte ao redor de uma localização.

```typescript
// Input
{
  name: "debug/source",
  arguments: {
    file: string;          // FQCN ou caminho
    line: number;          // Linha central
    context_lines?: number; // Linhas antes/depois (default: 10)
  }
}

// Output
{
  content: [{
    type: "text",
    text: JSON.stringify({
      file: "src/main/java/com/example/PedidoService.java",
      start_line: 37,
      end_line: 57,
      current_line: 47,
      lines: [
        { n: 37, text: "    @PostMapping(\"/api/pedidos\")" },
        { n: 38, text: "    public PedidoResponse criarPedido(@RequestBody PedidoDTO dto) {" },
        // ...
        { n: 47, text: "        String nome = cliente.getNome();  // NPE here", is_current: true, has_breakpoint: false },
        // ...
      ]
    })
  }]
}
```

---

### Tabela Resumo de Tools

| Tool | Categoria | Tokens típicos (output) | Latência típica |
|---|---|---|---|
| `debug/launch` | lifecycle | ~50 | 3-30s (compilação) |
| `debug/attach` | lifecycle | ~30 | <1s |
| `debug/disconnect` | lifecycle | ~20 | <1s |
| `debug/continue` | control | ~40 | variável |
| `debug/step_over` | control | ~40 | <100ms |
| `debug/step_into` | control | ~40 | <100ms |
| `debug/step_out` | control | ~40 | <100ms |
| `debug/breakpoint` | breakpoint | ~20 | <100ms |
| `debug/catch` | breakpoint | ~15 | <100ms |
| `debug/locals` | inspect | ~30-100 | <200ms |
| `debug/inspect` | inspect | ~20-80 | <200ms |
| `debug/evaluate` | inspect | ~15-50 | <500ms |
| `debug/stacktrace` | inspect | ~40-80 | <100ms |
| `debug/threads` | inspect | ~20-60 | <100ms |
| `debug/source` | info | ~60-120 | <100ms |

**Total por sessão típica (NPE simples):** ~87 tokens, 6 tool calls, 3.2s

---

<a id="rfc-002"></a>
## RFC-002: JDB Backend — Protocolo de Comunicação

### Resumo

Especifica como o Glassbox se comunica com o JDB CLI: spawn do processo, envio de comandos, parsing de respostas, detecção de eventos assíncronos.

### Ciclo de Vida do Processo JDB

```
1. Spawn:     child_process.spawn('jdb', ['-connect', 'com.sun.jdi.SocketAttach:hostname=localhost,port=5005'])
2. Wait:      Aguardar prompt ">" no stdout (indica JDB pronto)
3. Command:   Escrever comando no stdin + '\n'
4. Response:  Ler stdout até próximo prompt ">"
5. Events:    Detectar linhas assíncronas (breakpoint hit, exception, thread death)
6. Close:     Enviar 'quit\n' ou kill processo
```

### Mapeamento Tool → Comando JDB

| MCP Tool | Comando JDB | Notas |
|---|---|---|
| `debug/continue` | `cont` | |
| `debug/step_over` | `next` | |
| `debug/step_into` | `step` | |
| `debug/step_out` | `step up` | |
| `debug/breakpoint` (set) | `stop at com.example.Class:47` | |
| `debug/breakpoint` (remove) | `clear com.example.Class:47` | |
| `debug/catch` | `catch java.lang.NullPointerException` | |
| `debug/locals` | `locals` | |
| `debug/inspect` | `print <expr>` ou `dump <expr>` | `dump` para objetos |
| `debug/evaluate` | `eval <expr>` | |
| `debug/stacktrace` | `where` ou `where all` | |
| `debug/threads` | `threads` | |
| `debug/source` | `list` | Requer source path |

### Detecção de Eventos Assíncronos

JDB emite eventos no stdout a qualquer momento. O parser precisa distinguir entre "resposta a um comando" e "evento assíncrono":

```typescript
// Padrões de eventos assíncronos (regex)
const ASYNC_PATTERNS = {
  breakpointHit: /^Breakpoint hit: "thread=(.+)", (.+), line=(\d+)/,
  exceptionCaught: /^Exception occurred: (.+) \(to be caught at: (.+)\)/,
  exceptionUncaught: /^Exception occurred: (.+) \(uncaught\)/,
  threadStarted: /^Thread (.+) started/,
  threadDied: /^Thread (.+) died/,
  vmDisconnected: /^The application has been disconnected/,
  vmDeath: /^The application exited/,
};
```

### Command Queue

Comandos JDB são sequenciais — não é possível enviar dois comandos simultaneamente. O Glassbox usa uma fila:

```typescript
class JdbCommandQueue {
  private queue: Array<{
    command: string;
    resolve: (output: string) => void;
    reject: (error: Error) => void;
    timeout: number;
  }> = [];

  private processing = false;

  async execute(command: string, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ command, resolve, reject, timeout: timeoutMs });
      this.processNext();
    });
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const { command, resolve, reject, timeout } = this.queue.shift()!;

    // 1. Escrever comando no stdin
    this.jdb.stdin.write(command + '\n');

    // 2. Coletar output até próximo prompt ">"
    const output = await this.collectUntilPrompt(timeout);

    // 3. Separar eventos assíncronos da resposta
    const { response, events } = this.separateEvents(output);

    // 4. Emitir eventos assíncronos
    events.forEach(ev => this.eventEmitter.emit(ev.type, ev));

    // 5. Resolver com a resposta
    resolve(response);
    this.processing = false;
    this.processNext();
  }
}
```

---

<a id="rfc-003"></a>
## RFC-003: Event Stream — Protocolo e Tipagem

### Resumo

Define o protocolo completo do Event Stream: formato, tipagem, delivery, e contrato entre producers e consumers.

### TypeScript Types Completos

```typescript
// ── Base ──
interface BaseEvent {
  ts: string;        // ISO 8601 com milissegundos
  seq: number;       // Monotônico, começa em 0
  session_id: string; // UUID da sessão de debug
  src: EventSource;
}

type EventSource = 'debugger' | 'ai' | 'user' | 'system';

// ── Eventos do Debugger ──
interface SessionStartedEvent extends BaseEvent {
  type: 'session_started';
  src: 'debugger';
  data: {
    pid: number;
    jdk_version: string;
    main_class: string;
    jdwp_port: number;
  };
}

interface BreakpointHitEvent extends BaseEvent {
  type: 'breakpoint_hit';
  src: 'debugger';
  data: {
    breakpoint_id: string;
    location: SourceLocation;
    thread: string;
  };
}

interface ExceptionCaughtEvent extends BaseEvent {
  type: 'exception_caught';
  src: 'debugger';
  data: {
    exception_type: string;  // FQCN
    message: string | null;
    location: SourceLocation;
    thread: string;
    is_caught: boolean;
  };
}

interface StepCompletedEvent extends BaseEvent {
  type: 'step_completed';
  src: 'debugger';
  data: {
    step_type: 'over' | 'into' | 'out';
    location: SourceLocation;
    thread: string;
  };
}

// ── Eventos da IA ──
interface AgentActionEvent extends BaseEvent {
  type: 'agent_action';
  src: 'ai';
  data: {
    tool: string;          // "debug/locals", "debug/evaluate", etc.
    request: unknown;       // Argumentos enviados
    result: unknown;        // Resultado recebido
    tokens_used: number;    // Estimativa de tokens consumidos
    duration_ms: number;
  };
}

interface DiagnosisEvent extends BaseEvent {
  type: 'diagnosis';
  src: 'ai';
  data: {
    bug_id: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    title: string;
    root_cause: string;
    affected_location: SourceLocation;
    total_tokens: number;
    elapsed_ms: number;
  };
}

interface FixProposedEvent extends BaseEvent {
  type: 'fix_proposed';
  src: 'ai';
  data: {
    bug_id: string;
    fix_type: 'code_change' | 'config_change' | 'dependency_update';
    file: string;
    diff: string;  // unified diff format
    explanation: string;
    confidence: number;  // 0-1
  };
}

// ── Eventos do Usuário ──
interface ControlChangeEvent extends BaseEvent {
  type: 'control_change';
  src: 'user' | 'ai';
  data: {
    from: 'ai' | 'user' | 'shared';
    to: 'ai' | 'user' | 'shared';
    reason: 'manual_takeover' | 'return_control' | 'session_start' | 'timeout';
  };
}

interface FixAppliedEvent extends BaseEvent {
  type: 'fix_applied';
  src: 'user';
  data: {
    bug_id: string;
    applied: boolean;  // true = aplicou, false = rejeitou
  };
}

// ── Eventos do Sistema ──
interface AppOutputEvent extends BaseEvent {
  type: 'app_stdout' | 'app_stderr';
  src: 'system';
  data: {
    text: string;
    truncated: boolean;
  };
}

// ── Union Type ──
type GlassboxEvent =
  | SessionStartedEvent
  | BreakpointHitEvent
  | ExceptionCaughtEvent
  | StepCompletedEvent
  | AgentActionEvent
  | DiagnosisEvent
  | FixProposedEvent
  | ControlChangeEvent
  | FixAppliedEvent
  | AppOutputEvent;

// ── Tipos auxiliares ──
interface SourceLocation {
  file: string;
  line: number;
  class: string;
  method: string;
}
```

### Delivery

| Consumer | Canal | Formato |
|---|---|---|
| TUI (Rust) | Unix socket ou pipe | JSONL (1 JSON por linha) |
| Web UI (React) | SSE (`/events`) | SSE `data: {json}\n\n` |
| Log file | File append | JSONL |
| Extensões | EventEmitter callback | JavaScript object |

---

<a id="rfc-004"></a>
## RFC-004: TUI — Layout, Painéis e Interação

### Resumo

Especifica o layout da TUI, comportamento de cada painel, hotkeys e interações.

### Layout Principal (4 painéis + barras)

```
┌── Title Bar ─────────────────────────────────────────────────────┐
│ ⟐ Glassbox │ com.example.PedidoService │ ● LIVE │ 87 tokens    │
├──────────────────────────────┬───────────────────────────────────┤
│                              │                                   │
│  Source Panel                │  Variables Panel                  │
│  (código com line numbers,   │  (variáveis locais do frame,     │
│   breakpoint markers,        │   expandíveis, com alertas)      │
│   current line highlight,    │                                   │
│   diff mode quando fix)      ├───────────────────────────────────┤
│                              │                                   │
│                              │  Agent Panel                      │
│                              │  (hipótese atual da IA,          │
│                              │   próximo passo, diagnosis)       │
│                              │                                   │
├──────────────────────────────┴───────────────────────────────────┤
│  Side Info: Call Stack │ Threads                                  │
├──────────────────────────────────────────────────────────────────┤
│  Event Log                                                       │
│  (timeline de todos os eventos, color-coded por source)          │
├──────────────────────────────────────────────────────────────────┤
│  Status Bar │ Mode: 🤖 AI │ Tokens: 87 │ Time: 3.2s │ F1=Help  │
└──────────────────────────────────────────────────────────────────┘
```

### Hotkeys

| Tecla | Ação | Disponível em |
|---|---|---|
| `F5` | Continue | Modo Manual/Colaborativo |
| `F9` | Toggle breakpoint na linha atual | Sempre |
| `F10` | Step Over | Modo Manual/Colaborativo |
| `F11` | Step Into | Modo Manual/Colaborativo |
| `F12` | Step Out | Modo Manual/Colaborativo |
| `Tab` | Trocar painel ativo | Sempre |
| `R` | Toggle controle IA ↔ Manual | Sempre |
| `/` | Abrir prompt de comando (eval/inspect) | Sempre |
| `A` | Aplicar fix proposto | Quando fix disponível |
| `D` | Descartar fix | Quando fix disponível |
| `S` | Salvar relatório da sessão | Quando sessão completa |
| `q` | Sair | Sempre |
| `?` / `F1` | Ajuda | Sempre |
| `j` / `k` | Scroll up/down no painel ativo | Sempre |
| `1-5` | Ir para painel específico | Sempre |

### Painéis — Comportamento Detalhado

#### Source Panel

- Exibe código-fonte com syntax highlighting (Java/Kotlin)
- Linha ativa marcada com `▸` e background highlight
- Breakpoints marcados com `◆` (vermelho)
- Exception marker `⚡` na linha da exceção
- **Modo Diff:** quando `fix_proposed`, exibe diff com linhas `+` (verde) e `-` (vermelho)
- Scroll automático para seguir a IA, mas dev pode scroll manualmente

#### Variables Panel

- Lista variáveis locais do frame atual
- Variáveis `null` ou suspeitas marcadas com `⚠️`
- Expandir/colapsar objetos com Enter
- Atualiza automaticamente quando IA chama `debug/locals` ou `debug/inspect`
- Watch expressions: dev pode adicionar expressões permanentes

#### Agent Panel

- Mostra o "pensamento" da IA em tempo real:
  - Status: "Investigando...", "Analisando...", "Fix encontrado"
  - Hipótese atual
  - Próximo passo planejado
- Quando `diagnosis`: mostra bug completo com severidade
- Quando `fix_proposed`: mostra diff + botões Aplicar/Descartar

#### Event Log

- Timeline cronológica de todos os eventos
- Color-coded: 🤖 roxo (IA), ⚡ vermelho (exceção), 🧑 azul (dev), ▶ verde (sistema)
- Timestamps à esquerda
- Scroll infinito com auto-scroll (desabilita se dev scrollar manualmente)

### Responsividade

| Terminal size | Layout |
|---|---|
| ≥ 120 cols | Layout completo (4 painéis + barras) |
| 80-119 cols | Source + Agent (tab para Variables) |
| < 80 cols | Apenas Event Log + Status |

---

<a id="rfc-005"></a>
## RFC-005: Controle de Turno — IA vs Desenvolvedor

### Resumo

Define como funciona a alternância de controle entre IA e desenvolvedor, incluindo o modo colaborativo.

### Modos

```typescript
type ControlMode = 'autonomous' | 'manual' | 'collaborative';

interface TurnState {
  mode: ControlMode;
  ai_can_act: boolean;
  user_can_act: boolean;
  ai_can_read: boolean;   // IA pode inspecionar (mesmo sem controle)
  user_can_read: boolean;  // Dev sempre pode ler
}

const MODES: Record<ControlMode, TurnState> = {
  autonomous: {
    mode: 'autonomous',
    ai_can_act: true,
    user_can_act: false,   // Dev observa
    ai_can_read: true,
    user_can_read: true,
  },
  manual: {
    mode: 'manual',
    ai_can_act: false,     // IA observa
    user_can_act: true,
    ai_can_read: true,     // IA ainda vê tudo (pode sugerir)
    user_can_read: true,
  },
  collaborative: {
    mode: 'collaborative',
    ai_can_act: true,
    user_can_act: true,    // Ambos podem agir
    ai_can_read: true,
    user_can_read: true,
  },
};
```

### Regras de Transição

```
autonomous → manual:        Dev pressiona [R]
manual → autonomous:        Dev pressiona [R]
autonomous → collaborative: Dev faz qualquer ação de debug (breakpoint, eval)
manual → collaborative:     IA recebe permissão para agir (dev aceita sugestão)
collaborative → autonomous: Dev pressiona [R] ou dev fica inativo por 30s
collaborative → manual:     Dev rejeita ação da IA ou pressiona [R] 2x
```

### Conflitos em Modo Colaborativo

Quando ambos podem agir, possíveis conflitos:

| Conflito | Resolução |
|---|---|
| IA e dev fazem `step` ao mesmo tempo | Fila — primeiro a chegar executa, segundo espera |
| IA quer `continue`, dev quer `step` | Dev tem prioridade (humano > IA) |
| IA remove breakpoint que dev setou | Não permitido — breakpoints do dev são protegidos |
| Dev e IA adicionam breakpoint na mesma linha | Merge — um breakpoint com atributo `set_by: "both"` |

---

<a id="rfc-006"></a>
## RFC-006: Ciclo de Vida de uma Sessão de Debug

### Resumo

Define o ciclo completo de uma sessão de debug, desde o pedido do desenvolvedor até a resolução do bug.

### Fases

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  SETUP   │───→│  HUNT    │───→│  FOUND   │───→│  FIX     │───→│ COMPLETE │
│          │    │          │    │          │    │          │    │          │
│ Launch/  │    │ Waiting  │    │ Inspect  │    │ Propose  │    │ Summary  │
│ Attach   │    │ for bug  │    │ Analyze  │    │ Apply    │    │ Report   │
│ Config   │    │ to occur │    │ Diagnose │    │ or Edit  │    │ Metrics  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──────────┘
```

### Fase 1: SETUP

```
Dev: "Debug meu endpoint /api/pedidos — tá dando NPE"

IA analisa o pedido:
1. Identifica: endpoint REST, exceção NPE
2. Decide: launch ou attach?
   - Se projeto local com pom.xml/build.gradle → debug/launch
   - Se processo rodando → debug/attach
3. Configura breakpoints iniciais:
   - debug/catch NullPointerException
   - debug/catch IllegalArgumentException (preventivo)
4. Resume: debug/continue
```

**Eventos emitidos:** `session_started`, N × `agent_action`

### Fase 2: HUNT

```
IA: aguardando exceção ser lançada
Dev: precisa reproduzir o bug (fazer request, etc.)
TUI: mostra "⏳ Aguardando exceção..."
```

**Eventos emitidos:** `app_stdout` (logs da aplicação)

### Fase 3: FOUND

```
Debugger: ⚡ NPE capturada!

IA executa sequência de investigação:
1. debug/stacktrace → ver call chain
2. debug/locals → ver variáveis do frame
3. debug/inspect <suspeito> → detalhar variável suspeita
4. debug/evaluate <expressão> → testar hipótese
5. (repete 3-4 se necessário)
6. Formula diagnóstico
```

**Eventos emitidos:** `exception_caught`, N × `agent_action`, `diagnosis`

### Fase 4: FIX

```
IA: gera diff com a correção proposta
TUI: mostra diff no Source Panel + diagnosis no Agent Panel

Dev escolhe:
[A] Aplicar fix → escreve o diff no arquivo, emite fix_applied
[D] Descartar → emite fix_applied(applied=false)
[E] Editar fix → abre editor com o diff proposto
[C] Continuar debug → volta para HUNT
```

**Eventos emitidos:** `fix_proposed`, `fix_applied`

### Fase 5: COMPLETE

```
Session Summary:
- Duração total
- Tool calls realizadas
- Tokens consumidos
- Custo estimado
- Bugs encontrados (lista)
- Fixes aplicados/rejeitados
- Comparativo vs abordagem tradicional

Dev escolhe:
[S] Salvar relatório (.json ou .md)
[N] Nova sessão
[Q] Sair
```

**Eventos emitidos:** `session_ended`

### Sessão completa como JSON

```json
{
  "session_id": "sess-abc123",
  "started_at": "2026-02-17T14:32:01Z",
  "ended_at": "2026-02-17T14:33:18Z",
  "duration_ms": 77000,
  "stats": {
    "tool_calls": 6,
    "tokens_used": 87,
    "estimated_cost_usd": 0.003,
    "events_total": 14
  },
  "bugs": [
    {
      "id": "NPE-001",
      "severity": "HIGH",
      "title": "NullPointerException por cliente inexistente",
      "location": "PedidoService.java:47",
      "root_cause": "findById(999) retorna Optional.empty, .orElse(null) permite null",
      "fix": {
        "type": "code_change",
        "file": "PedidoService.java",
        "status": "applied"
      }
    }
  ],
  "comparison": {
    "traditional_estimated_tokens": 4200,
    "traditional_estimated_time_min": 18,
    "token_savings_pct": 97.9,
    "time_savings_pct": 99.3
  }
}
```
