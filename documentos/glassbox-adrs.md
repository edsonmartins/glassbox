# Glassbox — Architecture Decision Records (ADRs)

**Projeto:** Glassbox — Debug Inteligente para JVM via MCP
**Autor:** EDSON — IntegrAllTech
**Data:** Fevereiro 2026
**Status:** Draft

---

## Índice

- [ADR-001: Linguagem do MCP Server](#adr-001)
- [ADR-002: Abstração de Backends de Debug](#adr-002)
- [ADR-003: Protocolo de Transporte MCP](#adr-003)
- [ADR-004: Tecnologia da TUI](#adr-004)
- [ADR-005: Formato do Event Stream](#adr-005)
- [ADR-006: Estratégia de Parsing do JDB](#adr-006)
- [ADR-007: Modelo de Concorrência e Sessões](#adr-007)
- [ADR-008: Distribuição e Packaging](#adr-008)

---

<a id="adr-001"></a>
## ADR-001: Linguagem do MCP Server

**Status:** Proposta
**Data:** 2026-02-17
**Decisores:** EDSON

### Contexto

O Glassbox precisa de um MCP Server que se comunique com clients MCP (Claude Desktop, Claude Code, Cursor, etc.) e controle backends de debug (JDB inicialmente). A escolha da linguagem impacta: ecossistema MCP, velocidade de desenvolvimento, performance, deployment e manutenção.

### Opções Avaliadas

#### Opção A: TypeScript (Node.js)

**Prós:**
- SDK MCP oficial da Anthropic (`@modelcontextprotocol/sdk`) é TypeScript
- 90%+ dos MCP servers existentes são TypeScript — ecossistema maduro
- `child_process` nativo para controlar JDB via stdin/stdout
- async/await natural para I/O concorrente
- npm publish simplifica distribuição (`npx @glassbox/mcp-server`)
- Prototipagem rápida, grande pool de devs

**Contras:**
- Performance inferior a linguagens compiladas (irrelevante para I/O-bound)
- Runtime Node.js necessário no host
- Tipagem menos rigorosa que Java/Rust (mitigado com strict mode)

**Complexidade de implementação:** Baixa
**Time-to-market:** ~4 semanas para v0.1

#### Opção B: Java 17 (Spring Boot)

**Prós:**
- 30+ anos de expertise do EDSON
- MCP SDK Java existe (Spring AI `spring-ai-starter-mcp-server`)
- Entendimento profundo de JDWP (mesmo ecossistema)
- JDI (Java Debug Interface) disponível — alternativa mais rica que JDB CLI
- Tipagem forte, refactoring seguro
- Integração natural com projetos Java existentes (VendaX, Mentors)

**Contras:**
- MCP SDK Java é menos maduro que TypeScript (menos exemplos, menos comunidade)
- Startup mais pesado (JVM), embora GraalVM Native Image mitigue
- Distribuição via JAR requer JRE no host (vs `npx` que "just works")
- Spring Boot é overengineering para um processo leve como MCP server
- Ecossistema MCP é TypeScript-first — nadar contra a corrente

**Complexidade de implementação:** Média
**Time-to-market:** ~6 semanas para v0.1

#### Opção C: Go

**Prós:**
- Binário estático, zero dependências no host
- Excelente para CLI tools e processos daemon
- Concorrência nativa (goroutines)
- Cross-compilation trivial
- Já usado no Linktor

**Contras:**
- Sem SDK MCP oficial (teria que implementar JSON-RPC manualmente)
- Ecossistema MCP praticamente inexistente em Go
- Verbose para manipulação de strings (parsing JDB output)
- Sem generics maduros para abstrações tipo-safe de debug

**Complexidade de implementação:** Alta (MCP from scratch)
**Time-to-market:** ~8 semanas para v0.1

#### Opção D: Kotlin

**Prós:**
- Roda na JVM — acesso direto a JDI
- Sintaxe moderna, concisa
- Coroutines para async
- Interop total com Java
- Pode usar MCP SDK Java

**Contras:**
- Mesmos problemas de distribuição do Java
- Pool de devs menor que TypeScript
- Ecossistema MCP igualmente imaturo

**Complexidade de implementação:** Média
**Time-to-market:** ~6 semanas para v0.1

### Análise Comparativa

| Critério (peso) | TypeScript | Java 17 | Go | Kotlin |
|---|---|---|---|---|
| SDK MCP maduro (25%) | ★★★★★ | ★★★☆☆ | ★☆☆☆☆ | ★★★☆☆ |
| Ecossistema MCP (20%) | ★★★★★ | ★★☆☆☆ | ★☆☆☆☆ | ★★☆☆☆ |
| Facilidade deploy (15%) | ★★★★★ | ★★☆☆☆ | ★★★★★ | ★★☆☆☆ |
| Performance (10%) | ★★★☆☆ | ★★★★☆ | ★★★★★ | ★★★★☆ |
| Expertise do time (10%) | ★★★☆☆ | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| Acesso ao JDWP/JDI (10%) | ★★☆☆☆ | ★★★★★ | ★★☆☆☆ | ★★★★★ |
| Time-to-market (10%) | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ |
| **Média ponderada** | **4.25** | **3.15** | **2.35** | **2.95** |

### Decisão

**TypeScript (Node.js)** para o MCP Server.

### Justificativa

O MCP Server é essencialmente um "tradutor" entre o protocolo MCP (JSON-RPC) e o backend de debug. É 100% I/O-bound — performance de CPU é irrelevante. O fator decisivo é o ecossistema: o SDK oficial é TypeScript, a documentação é TypeScript, 90% dos exemplos são TypeScript, e a distribuição via npm é o padrão que os usuários esperam.

A desvantagem principal (sem acesso direto a JDI) é mitigada usando JDB CLI como backend, que é controlável via `child_process.spawn()`. Se no futuro precisarmos de JDI, podemos criar um "bridge" Java que expõe JDI via stdin/stdout JSON.

### Abordagem Híbrida Futura

```
v0.1:  TypeScript → JDB CLI (child_process)
v0.3:  TypeScript → [JDI Bridge em Java] → JDWP     (se necessário)
v0.3:  TypeScript → DAP Protocol → debugpy/delve/etc (multi-linguagem)
```

### Consequências

- (+) Distribuição trivial: `npx @glassbox/mcp-server`
- (+) Máxima compatibilidade com ecossistema MCP
- (+) Comunidade pode contribuir facilmente
- (-) Parsing de output JDB em texto é frágil
- (-) Se JDI for necessário, requer bridge Java adicional
- Mitigação: ADR-006 define estratégia robusta de parsing JDB

---

<a id="adr-002"></a>
## ADR-002: Abstração de Backends de Debug

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

Glassbox v0.1 suporta apenas Java (via JDB), mas o roadmap prevê Python (debugpy), Go (Delve), Rust/C++ (lldb-dap) e JavaScript (js-debug). Precisamos de uma abstração que permita adicionar backends sem mudar o MCP Server.

### Opções

#### Opção A: Interface TypeScript customizada

Definir uma interface `DebugBackend` em TypeScript e implementar cada backend como classe.

```typescript
interface DebugBackend {
  launch(config: LaunchConfig): Promise<Session>;
  attach(config: AttachConfig): Promise<Session>;
  setBreakpoint(location: Location): Promise<Breakpoint>;
  continue(threadId?: string): Promise<StopEvent>;
  stepOver(threadId: string): Promise<StopEvent>;
  getLocals(threadId: string, frameIndex: number): Promise<Variable[]>;
  evaluate(expression: string, threadId: string, frameIndex: number): Promise<EvalResult>;
  // ...
}
```

**Prós:** Controle total, tipagem, sem dependências externas
**Contras:** Cada backend é trabalho manual significativo

#### Opção B: DAP (Debug Adapter Protocol) como abstração universal

DAP é o protocolo que o VS Code usa para se comunicar com debuggers. Já existe DAP adapter para: Python (debugpy), Go (delve), C/C++/Rust (lldb-dap, codelldb), Java (java-debug), Node.js (js-debug).

```
Glassbox MCP Server
    ↓
  DebugCore (DAP Client)
    ↓
  DAP Protocol (JSON over stdio)
    ↓
  DAP Adapter (debugpy, delve, lldb-dap, etc.)
    ↓
  Runtime (Python, Go, Rust, etc.)
```

**Prós:** Um protocolo = todos os backends grátis. Comunidade mantém os adapters.
**Contras:** JDB não tem DAP adapter oficial (precisa de adapter custom ou wrapper)

#### Opção C: Híbrido — JDB nativo + DAP para o resto

v0.1: Backend JDB customizado (parsing direto do CLI)
v0.3: DAP client para backends que já têm DAP adapters

### Decisão

**Opção C: Híbrido**

### Justificativa

JDB é peculiar — não tem DAP adapter oficial e funciona melhor com parsing direto. Mas para Python/Go/Rust/JS, usar DAP evita reimplementar o que o VS Code já resolveu. A interface `DebugBackend` encapsula ambas as abordagens.

### Arquitetura

```
DebugBackend (interface)
├── JdbBackend        ← v0.1 — controla JDB CLI diretamente
├── DapBackend        ← v0.3 — client DAP genérico
│   ├── uses debugpy     (Python)
│   ├── uses dlv dap     (Go)
│   ├── uses lldb-dap    (Rust/C/C++)
│   └── uses js-debug    (Node.js/TS)
└── JdiBackend        ← futuro — bridge Java com JDI direto
```

### Consequências

- (+) JDB funciona imediatamente sem dependência DAP
- (+) DAP abre suporte a 5+ linguagens com mínimo esforço
- (+) Interface unificada: MCP tools não mudam por backend
- (-) Dois paradigmas de backend (parsing CLI vs protocolo DAP)
- Mitigação: Interface `DebugBackend` esconde a diferença

---

<a id="adr-003"></a>
## ADR-003: Protocolo de Transporte MCP

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

MCP suporta três transportes: stdio, SSE (Server-Sent Events) e Streamable HTTP. A escolha afeta como o Glassbox se conecta a clients MCP.

### Opções

| Transporte | Uso | Prós | Contras |
|---|---|---|---|
| **stdio** | Claude Desktop, Claude Code, Cursor | Zero config, padrão MCP, simples | Só local, 1 client por processo |
| **SSE** | Web apps, remote | Múltiplos clients, streaming natural | Config de rede, CORS |
| **Streamable HTTP** | Cloud, multi-tenant | Escalável, stateless | Complexidade, overhead |

### Decisão

**stdio como transporte primário** com SSE como secundário para Web UI.

### Justificativa

90% dos usuários vão usar Glassbox com Claude Desktop ou Claude Code, que usam stdio. SSE é necessário apenas para a Web UI futura e pode ser adicionado como flag de runtime.

```bash
# Default: stdio (para Claude Desktop, Claude Code, Cursor)
npx @glassbox/mcp-server

# Com SSE habilitado (para Web UI)
npx @glassbox/mcp-server --transport sse --port 3100
```

---

<a id="adr-004"></a>
## ADR-004: Tecnologia da TUI

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

A TUI é o diferencial do Glassbox — o desenvolvedor vê em tempo real o que a IA está fazendo no debugger. Precisa ser rica (painéis, syntax highlighting, scroll), performática e cross-platform.

### Opções

#### Opção A: Rust + Ratatui

- Framework TUI mais popular do ecossistema Rust
- Usado por: bottom (monitor), gitui (git), spotify-tui
- Rendering a 60fps, zero flickering
- Excelente suporte a Unicode, cores, layouts complexos
- Binário estático ~3MB

#### Opção B: Go + Bubbletea (Charm)

- Framework TUI do ecossistema Charm (Lip Gloss, Bubbles, etc.)
- Usado por: soft-serve, glow, lazygit
- Modelo Elm-like (Model-Update-View)
- Binário estático ~5MB
- Componentes pré-prontos (table, viewport, spinner)

#### Opção C: TypeScript + Ink (React para terminal)

- React components no terminal
- Usado por: Pastel, Create-React-App CLI
- Mesmo paradigma do React — familiar para web devs
- Roda em Node.js (já presente por causa do MCP Server)

#### Opção D: TypeScript + Blessed/Neo-Blessed

- Widgets clássicos de terminal (window, list, table)
- API estável mas projeto com pouca manutenção
- Roda em Node.js

### Análise

| Critério | Rust+Ratatui | Go+Bubbletea | TS+Ink | TS+Blessed |
|---|---|---|---|---|
| Performance rendering | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★★☆☆ |
| Riqueza visual | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★★★☆ |
| Curva de aprendizado | ★★☆☆☆ | ★★★☆☆ | ★★★★★ | ★★★★☆ |
| Dep. adicional | Nenhuma | Nenhuma | Node.js (já tem) | Node.js (já tem) |
| Deploy size | ~3MB | ~5MB | ~0 (bundled) | ~0 (bundled) |
| Manutenção comunidade | ★★★★★ | ★★★★★ | ★★★☆☆ | ★★☆☆☆ |

### Decisão

**Rust + Ratatui** para a TUI principal, com **Ink (React)** como fallback leve para quem não quer instalar o binário Rust.

### Justificativa

A TUI é a "vitrine" do produto — precisa impressionar. Ratatui permite painéis complexos (Source, Variables, Agent, Events, Stack, Threads) com rendering suave a 60fps. Nenhuma outra opção atinge esse nível de polish no terminal.

O trade-off é que a TUI é um binário separado do MCP Server. Isso é aceitável porque:
1. A TUI é opcional — Glassbox funciona sem ela (a IA opera via MCP tools)
2. Pode ser instalada independentemente: `cargo install glassbox-tui` ou download de release
3. Ink pode servir como TUI "lite" embutida no próprio MCP Server para quem não quer Rust

### Comunicação MCP Server ↔ TUI

```
MCP Server (TypeScript)
    │
    │ Event Stream (JSON lines via stdout pipe ou socket Unix)
    ↓
TUI (Rust/Ratatui)
    → Renderiza painéis em tempo real
    → Envia comandos do dev de volta ao MCP Server
```

---

<a id="adr-005"></a>
## ADR-005: Formato do Event Stream

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

Toda ação no Glassbox (da IA, do debugger, do desenvolvedor) gera um evento. Esses eventos alimentam TUI, Web UI e logs. Precisamos de um formato que seja: streamable, tipado, extensível e serializável.

### Decisão

**JSON Lines (JSONL)** — um objeto JSON por linha, separado por `\n`.

### Formato

```jsonl
{"ts":"2026-02-17T14:33:15.123Z","type":"exception_caught","src":"debugger","data":{"exception":"java.lang.NullPointerException","file":"PedidoService.java","line":47,"thread":"http-nio-8080-exec-1"}}
{"ts":"2026-02-17T14:33:15.234Z","type":"agent_action","src":"ai","data":{"tool":"debug/locals","result":{"variables":[{"name":"dto","type":"PedidoDTO","value":"{clienteId=999}"},{"name":"cliente","type":"Cliente","value":"null","alert":true}]},"tokens":42}}
{"ts":"2026-02-17T14:33:17.789Z","type":"diagnosis","src":"ai","data":{"bug_id":"NPE-001","severity":"HIGH","title":"NullPointerException por cliente inexistente","root_cause":"findById(999) retorna Optional.empty","fix":{"type":"code_change","file":"PedidoService.java","diff":"..."},"total_tokens":87,"elapsed_ms":3200}}
{"ts":"2026-02-17T14:34:00.000Z","type":"control_change","src":"user","data":{"from":"ai","to":"user","reason":"manual_takeover"}}
```

### Tipos de Evento

| Categoria | Tipos | Source |
|---|---|---|
| **Debug** | `session_started`, `session_ended`, `breakpoint_hit`, `exception_caught`, `thread_started`, `thread_died`, `step_completed` | debugger |
| **Agent** | `agent_action` (com subtipo tool), `agent_thinking`, `diagnosis`, `fix_proposed` | ai |
| **User** | `control_change`, `manual_step`, `manual_eval`, `breakpoint_added`, `watch_added`, `fix_applied`, `fix_rejected` | user |
| **System** | `app_started`, `app_stdout`, `app_stderr`, `error` | system |

### Schema TypeScript

```typescript
interface GlassboxEvent {
  ts: string;          // ISO 8601
  type: EventType;     // discriminated union
  src: 'debugger' | 'ai' | 'user' | 'system';
  data: Record<string, unknown>;
  seq?: number;        // sequence number monotônico
  session_id?: string; // para multi-sessão
}
```

### Canais de distribuição

```
Event Stream (in-process)
├── → stdout pipe    → TUI (Rust)
├── → SSE endpoint   → Web UI (React)
├── → file append    → Log persistente (.jsonl)
└── → callback       → Extensões/plugins
```

### Consequências

- (+) JSONL é parseável linha a linha — streaming natural
- (+) Extensível — novos campos não quebram consumers antigos
- (+) Ferramentas como `jq` funcionam diretamente para debug
- (-) Verboso comparado a binário (irrelevante para volume de debug)

---

<a id="adr-006"></a>
## ADR-006: Estratégia de Parsing do JDB

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

JDB é um debugger CLI que recebe comandos via stdin e retorna resultados em texto livre via stdout. O parsing desse output é o ponto mais frágil do Glassbox v0.1.

### Problema

JDB não retorna JSON. Retorna texto como:

```
Breakpoint hit: "thread=http-nio-8080-exec-1", com.example.PedidoService.criarPedido(), line=47

 http-nio-8080-exec-1[1] locals
 Method arguments:
  dto = instance of com.example.PedidoDTO(id=338)
 Local variables:
  cliente = null
  nome = <not yet computed>
```

### Estratégia

**Parser robusto baseado em regex + state machine:**

1. **Regex patterns por tipo de output** — cada comando JDB tem padrão previsível
2. **State machine para contexto** — saber se estamos em "locals output", "stack output", etc.
3. **Timeout por resposta** — JDB não sinaliza "fim de output", usamos heurística temporal
4. **Testes extensivos** — snapshot tests com outputs reais de diferentes versões JDK

```typescript
// Exemplo: parser de locals
const LOCALS_PATTERNS = {
  methodArg: /^\s+(\w+)\s+=\s+(.+)$/,
  localVar:  /^\s+(\w+)\s+=\s+(.+)$/,
  instance:  /instance of ([\w.]+)\(id=(\d+)\)/,
  null:      /^null$/,
  notComputed: /<not yet computed>/,
};
```

### Alternativa futura: JDI Bridge

Se o parsing JDB se tornar insustentável:

```
MCP Server (TypeScript)
    ↓ stdin/stdout JSON
JDI Bridge (Java, ~100 linhas)
    ↓ JDI API (com.sun.jdi.*)
JDWP
    ↓
JVM target
```

O JDI Bridge seria um JAR standalone que recebe comandos JSON via stdin e retorna resultados JSON via stdout — eliminando completamente o problema de parsing texto.

### Decisão

**JDB CLI com parsing robusto para v0.1**, com JDI Bridge como escape hatch planejado.

### Consequências

- (+) Zero dependências além do JDK (jdb vem com o JDK)
- (+) Funciona em qualquer JDK 11+
- (-) Parsing frágil se JDB mudar formato entre versões
- Mitigação: testes de snapshot, JDI Bridge como plano B

---

<a id="adr-007"></a>
## ADR-007: Modelo de Concorrência e Sessões

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

Glassbox precisa lidar com: comunicação MCP (JSON-RPC bidirecional), controle do processo JDB (stdin/stdout assíncrono), event stream (broadcast para TUI/Web), e possíveis múltiplas sessões de debug.

### Decisão

**Single-session para v0.1**, com arquitetura preparada para multi-session.

### Modelo v0.1

```
1 MCP Connection ←→ 1 Glassbox Instance ←→ 1 Debug Session ←→ 1 JDB Process
```

Simples, sem race conditions, cada instância do MCP server atende um client.

### Modelo futuro (v1.0)

```
N MCP Connections ←→ 1 Glassbox Server ←→ N Debug Sessions ←→ N JDB Processes
                                              ↓
                                    Session Manager (session_id routing)
```

### Concorrência interna (v0.1)

```typescript
// Node.js event loop lida naturalmente com:
// 1. MCP JSON-RPC messages (via stdin)
// 2. JDB stdout events (via child_process)
// 3. Event stream emission (via EventEmitter)

class GlassboxServer {
  private mcp: McpServer;           // SDK oficial
  private debugSession: JdbBackend; // child_process
  private eventStream: EventEmitter; // broadcast

  // Tudo é async/await — Node.js event loop gerencia
}
```

### Controle de turno (IA vs Dev)

```typescript
type Controller = 'ai' | 'user' | 'shared';

class TurnManager {
  private controller: Controller = 'ai';

  canAiAct(): boolean {
    return this.controller === 'ai' || this.controller === 'shared';
  }

  canUserAct(): boolean {
    return this.controller === 'user' || this.controller === 'shared';
  }

  transfer(to: Controller, reason: string): void {
    this.emit('control_change', { from: this.controller, to, reason });
    this.controller = to;
  }
}
```

---

<a id="adr-008"></a>
## ADR-008: Distribuição e Packaging

**Status:** Proposta
**Data:** 2026-02-17

### Contexto

Glassbox tem dois artefatos: o MCP Server (TypeScript) e a TUI (Rust). Precisamos que a instalação seja trivial para o desenvolvedor.

### Decisão

**Distribuição separada** com instalação unificada via npm.

### Plano

```bash
# MCP Server — npm (funciona em qualquer OS com Node.js 18+)
npm install -g @glassbox/mcp-server
# ou uso direto:
npx @glassbox/mcp-server

# TUI — binário pré-compilado (opcional)
# Via npm postinstall (detecta OS, baixa binário):
npm install -g @glassbox/tui

# Ou via cargo:
cargo install glassbox-tui

# Ou download direto (GitHub Releases):
# glassbox-tui-linux-x64, glassbox-tui-darwin-arm64, glassbox-tui-windows-x64.exe
```

### Matriz de compatibilidade

| Componente | Requisito | Distribuição |
|---|---|---|
| MCP Server | Node.js 18+ | npm / npx |
| TUI | Nenhum (binário estático) | npm (postinstall) / cargo / GitHub Release |
| Debug (Java) | JDK 11+ com `jdb` | Já presente no sistema |
| Debug (Python) | Python 3.7+ com `debugpy` | pip install debugpy |
| Debug (Go) | Go com `dlv` | go install dlv |

### Consequências

- (+) `npx @glassbox/mcp-server` funciona em <5 segundos
- (+) TUI é opcional — Glassbox funciona sem ela
- (+) Binários Rust compilados via GitHub Actions para 3 OS × 2 arch
- (-) Dois mecanismos de distribuição (npm + cargo/release)
- Mitigação: npm postinstall pode baixar o binário TUI automaticamente
