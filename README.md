# GlassBox

**Debug inteligente para JVM via MCP — a IA controla o debugger, voce observa.**

GlassBox e um debugger de JVM controlado por inteligencia artificial, construido sobre o [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Diferente de debuggers tradicionais onde o desenvolvedor opera o debugger manualmente, o GlassBox inverte o modelo: a IA conduz a investigacao (define breakpoints, inspeciona variaveis, navega pelo stack) enquanto o desenvolvedor acompanha tudo em tempo real por uma interface de terminal (TUI).

## Arquitetura

```
┌─────────────┐     MCP (stdio)     ┌──────────────────┐     JDWP      ┌─────────┐
│   Claude /   │◄──────────────────►│  GlassBox MCP    │◄────────────►│   JVM   │
│   AI Client  │   JSON-RPC         │  Server (TS)     │   JDB        │  (Java) │
└─────────────┘                     └────────┬─────────┘              └─────────┘
                                             │
                                    Unix Socket (JSONL)
                                             │
                                    ┌────────▼─────────┐
                                    │  GlassBox TUI    │
                                    │  (Rust/Ratatui)  │
                                    └──────────────────┘
```

O projeto e um monorepo com dois pacotes:

| Pacote | Linguagem | Descricao |
|--------|-----------|-----------|
| `packages/mcp-server` | TypeScript | Servidor MCP com 17 tools de debug, backend JDB |
| `packages/tui` | Rust | Interface de terminal em tempo real com Ratatui |

## Funcionalidades

### 17 Ferramentas MCP

As ferramentas estao organizadas em 5 categorias:

| Categoria | Ferramentas | Descricao |
|-----------|-------------|-----------|
| **Lifecycle** (3) | `debug/launch`, `debug/attach`, `debug/disconnect` | Iniciar, conectar e desconectar sessoes de debug |
| **Control** (4) | `debug/continue`, `debug/step_over`, `debug/step_into`, `debug/step_out` | Controle de execucao do programa |
| **Breakpoints** (2) | `debug/breakpoint`, `debug/catch` | Gerenciamento de breakpoints e catch de excecoes |
| **Inspection** (7) | `debug/locals`, `debug/inspect`, `debug/evaluate`, `debug/stacktrace`, `debug/threads`, `debug/classes`, `debug/methods` | Inspecao de estado: variaveis, stack, threads, classes |
| **Source** (1) | `debug/source` | Leitura de codigo-fonte com contexto |

### 3 Modos de Controle

- **Autonomous** — A IA conduz toda a investigacao de forma independente. O desenvolvedor observa pelo TUI.
- **Manual** — O desenvolvedor assume o controle, usando hotkeys (F5, F6, F7, F8) para step/continue. A IA fica em pausa.
- **Collaborative** — Ambos podem agir. O usuario tem prioridade em conflitos. Apos 30s de inatividade do usuario, reverte para Autonomous.

Alterne entre os modos com a tecla `Tab` no TUI.

### Interface TUI

A TUI mostra 4 paineis simultaneos:

- **Source** — Codigo-fonte com numeracao de linhas, breakpoints (`◆`), linha atual (`▸`), syntax highlighting Java
- **Variables** — Variaveis locais com expand/collapse, watch expressions
- **Agent Log** — Acoes da IA em tempo real (tools chamadas, diagnosticos, fixes)
- **Side Info** — Stack trace, threads, breakpoints ativos, informacoes da sessao

Funcionalidades adicionais:
- **Command prompt** (`/`) — Comandos interativos: `eval <expr>`, `watch <expr>`, `bp <arquivo>:<linha>`
- **Fix proposals** — Visualizacao de diffs propostos pela IA com opcao de aceitar ou rejeitar
- **Timeline** — Linha do tempo compacta dos eventos na barra de status
- **Estimativa de custo** — Tokens usados e custo estimado na barra de titulo

### 21 Tipos de Eventos

O stream JSONL entre o servidor e a TUI suporta 21 tipos de eventos incluindo: `session_started`, `exception_caught`, `breakpoint_hit`, `agent_action`, `agent_thinking`, `diagnosis`, `fix_proposed`, `control_change`, entre outros.

## Pre-requisitos

- **Node.js** >= 18
- **Rust** (com Cargo) — para compilar a TUI
- **pnpm** >= 9 — gerenciador de pacotes do monorepo
- **JDK** com JDB — o debugger de linha de comando do Java

## Instalacao

```bash
# Clonar o repositorio
git clone https://github.com/seu-usuario/glassbox.git
cd glassbox

# Instalar dependencias do MCP Server
pnpm install

# Compilar o MCP Server
cd packages/mcp-server
pnpm build

# Compilar a TUI
cd ../tui
cargo build --release
```

O binario da TUI estara em `packages/tui/target/release/glassbox-tui`.

## Guia de Uso

### Passo 1: Configurar o MCP Server no Claude Desktop

O GlassBox funciona como um servidor MCP que o Claude (ou outro cliente MCP) utiliza para controlar o debugger. Adicione ao arquivo `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "node",
      "args": ["/caminho/absoluto/para/packages/mcp-server/dist/index.js", "--tui"],
      "env": {
        "GLASSBOX_TUI": "1"
      }
    }
  }
}
```

> **Nota:** A flag `--tui` (ou a variavel `GLASSBOX_TUI=1`) ativa a bridge de comunicacao via Unix socket. Sem ela, os eventos sao emitidos apenas via stderr.

Ao iniciar, o servidor imprime o caminho do socket no stderr:
```
glassbox-tui-socket: /tmp/glassbox-abc123.sock
```

### Passo 2: Abrir a TUI

Em outro terminal, inicie a TUI para acompanhar a sessao de debug em tempo real:

**Modo Socket** (recomendado — bidirecional, permite enviar comandos):

```bash
# Auto-discovery: busca automaticamente /tmp/glassbox-*.sock
glassbox-tui --input socket

# Ou especificando o caminho do socket
glassbox-tui --input socket --socket /tmp/glassbox-abc123.sock
```

**Modo Pipe** (somente leitura, util para replay de sessoes):

```bash
# Replay de um arquivo JSONL gravado
cat sessao-gravada.jsonl | glassbox-tui

# Pipe direto do stderr do MCP server
node dist/index.js 2>&1 | glassbox-tui
```

### Passo 3: Pedir ao Claude para debugar

Com o MCP server configurado, basta pedir ao Claude para investigar um bug. Exemplo:

> "Minha aplicacao Spring Boot esta lancando NullPointerException no endpoint /api/pedidos. Use o GlassBox para debugar."

O Claude ira automaticamente:

1. **Lancar a aplicacao** via `debug/launch`:
   ```
   project_dir: "/caminho/do/projeto"
   build_tool: "maven"
   main_class: "com.example.Application"
   ```

2. **Configurar exception handler** via `debug/catch`:
   ```
   exception_class: "java.lang.NullPointerException"
   ```

3. **Continuar execucao** via `debug/continue` e aguardar a excecao

4. **Investigar** quando a excecao for capturada:
   - `debug/stacktrace` — ver a pilha de chamadas
   - `debug/locals` — inspecionar variaveis locais
   - `debug/inspect` — examinar objetos em profundidade
   - `debug/evaluate` — avaliar expressoes no contexto
   - `debug/source` — ver o codigo-fonte ao redor

5. **Diagnosticar** o bug com severidade e causa raiz

6. **Propor um fix** com diff do codigo corrigido

### Passo 4: Acompanhar pela TUI

Enquanto o Claude investiga, a TUI mostra tudo em tempo real nos 4 paineis:

```
┌─ GlassBox ──── com.example.App ──── Tokens: 112 ~$0.003 ─────────────┐
│                                                                        │
│  ┌─ [SOURCE] ──────────────────────┐  ┌─ [VARIABLES] ───────────────┐ │
│  │  45 │   public void criarPedido │  │ ▸ dto: PedidoDTO {id=338}   │ │
│  │  46 │     PedidoDTO dto) {      │  │   cliente: null  ⚠          │ │
│  │  47 │▸    Cliente cliente =     │  │   pedidoRepo: PedidoRepo... │ │
│  │  48 │     clienteRepo.findBy... │  │                             │ │
│  │  49 │◆    cliente.getNome();    │  │ ── Watch ──                 │ │
│  │                                 │  │   dto.getClienteId() = 999  │ │
│  └─────────────────────────────────┘  └─────────────────────────────┘ │
│  ┌─ [AGENT LOG] ───────────────────┐  ┌─ [SIDE INFO] ──────────────┐ │
│  │ 14:32:04 debug/catch NPE        │  │ Stack: criarPedido:47      │ │
│  │ 14:32:05 debug/continue         │  │        PedidoController:23 │ │
│  │ 14:32:06 ⚡ NPE caught! line 47 │  │ Thread: http-exec-1        │ │
│  │ 14:32:07 debug/stacktrace       │  │ Breakpoints: 1 active      │ │
│  │ 14:32:08 debug/locals           │  │ Bugs: 1 found              │ │
│  │ 14:32:09 Diagnosis: NPE-001 HIGH│  │                             │ │
│  └─────────────────────────────────┘  └─────────────────────────────┘ │
│  ● NPE ── ● stk ── ● loc ── ● diag ── ● fix          3.2s, 6 calls │
│  AUTONOMOUS │ [Tab]Mode [1-4]Panel [/]Cmd [q]Quit                     │
└───────────────────────────────────────────────────────────────────────┘
```

### Passo 5: Interagir (opcional)

Voce pode assumir o controle a qualquer momento:

**Alternar para modo Manual** — Pressione `Tab` para assumir o controle:
- `F5` — Continue (retomar execucao)
- `F6` — Step Over (proxima linha)
- `F7` — Step Into (entrar na funcao)
- `F8` — Step Out (sair da funcao)

**Usar o command prompt** — Pressione `/` para comandos interativos:
- `eval dto.getClienteId()` — avaliar expressao Java no contexto atual
- `watch order.getTotal()` — monitorar uma expressao (atualiza automaticamente)
- `bp PedidoService.java:49` — adicionar/remover breakpoint
- `inspect clienteRepo` — inspecionar um objeto em profundidade

**Aceitar ou rejeitar fixes** — Quando a IA propoe uma correcao:
- `y` — Aceitar o fix proposto
- `n` — Rejeitar e continuar investigando

**Salvar relatorio** — Pressione `s` para salvar um relatorio da sessao

### Passo 6: Revisar o resultado

Ao final da sessao, a TUI mostra um resumo com:
- Numero de bugs encontrados
- Total de tool calls e tokens utilizados
- Estimativa de custo
- Comparacao com debugging manual (economia estimada)
- Duracao total da sessao

---

### Cenario Completo: Investigando um NullPointerException

Aqui esta o fluxo tipico de uma sessao de debug completa:

```
1. [session_started]    Sessao iniciada: PedidoService (pid 1234, JDK 17)
2. [agent_action]       AI chama debug/catch NullPointerException
3. [agent_action]       AI chama debug/continue
4. [app_stdout]         App: "Servidor rodando em http://localhost:8080"
5. [exception_caught]   ⚡ NullPointerException em PedidoService.java:47
6. [agent_thinking]     "Investigando NullPointerException no metodo criarPedido..."
7. [agent_action]       AI chama debug/stacktrace → 5 frames
8. [agent_action]       AI chama debug/locals → dto (ok), cliente (null ⚠)
9. [agent_action]       AI chama debug/evaluate "clienteRepo.findById(999)" → Optional.empty
10. [diagnosis]         Bug NPE-001 (HIGH): cliente e null porque findById retorna empty
11. [fix_proposed]      Substituir .orElse(null) por .orElseThrow(...)
12. [fix_applied]       Usuario aceitou o fix (y)
13. [session_ended]     112 tokens, 1 bug, 3.2s, custo ~$0.003
```

### Cenario: Modo Colaborativo

```
1. [session_started]    Sessao iniciada em modo Autonomous
2. [exception_caught]   IllegalStateException em OrderController.java:85
3. [control_change]     Usuario pressionou Tab → modo Manual
4. [manual_step]        Usuario: F6 (step over) → linha 86
5. [manual_step]        Usuario: F7 (step into) → OrderService.java:142
6. [manual_eval]        Usuario: /eval order.getStatus() → "SHIPPED"
7. [control_change]     Usuario pressionou Tab → devolveu controle para AI
8. [agent_thinking]     "O usuario descobriu que order.status e SHIPPED..."
9. [diagnosis]          Bug ISE-001 (MEDIUM): transicao de estado invalida
10. [session_ended]     57 tokens, 1 bug
```

---

### Referencia Rapida

#### Variaveis de Ambiente

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `GLASSBOX_TUI` | `1` | Ativa a bridge TUI no MCP server |

#### Argumentos CLI da TUI

| Argumento | Padrao | Descricao |
|-----------|--------|-----------|
| `--input` | `stdin` | Fonte de entrada: `stdin` (pipe) ou `socket` (bidirecional) |
| `--socket` | auto-discovery | Caminho do Unix socket (quando `--input socket`) |

#### Hotkeys da TUI

| Tecla | Acao | Modo |
|-------|------|------|
| `Tab` | Alternar modo de controle | Todos |
| `1-4` | Selecionar painel ativo | Todos |
| `j/k` | Scroll / selecao de variaveis | Todos |
| `/` | Abrir command prompt | Todos |
| `w` | Adicionar watch expression | Todos |
| `Enter` | Expandir/colapsar variavel | Painel Variables |
| `x` | Remover watch selecionado | Painel Variables |
| `F5` | Continue | Manual |
| `F6` | Step Over | Manual |
| `F7` | Step Into | Manual |
| `F8` | Step Out | Manual |
| `y` | Aceitar fix proposto | Quando fix disponivel |
| `n` | Rejeitar fix proposto | Quando fix disponivel |
| `s` | Salvar relatorio | Todos |
| `q` | Sair | Todos |

#### Comandos do Prompt (`/`)

| Comando | Exemplo | Descricao |
|---------|---------|-----------|
| `eval <expr>` | `eval dto.getClienteId()` | Avaliar expressao Java |
| `inspect <expr>` | `inspect clienteRepo` | Inspecionar objeto |
| `watch <expr>` | `watch order.getTotal()` | Monitorar expressao |
| `bp <arquivo>:<linha>` | `bp PedidoService.java:49` | Toggle breakpoint |

#### Ferramentas MCP Detalhadas

**Lifecycle:**

| Tool | Input | Descricao |
|------|-------|-----------|
| `debug/launch` | `project_dir`, `build_tool` (maven/gradle/manual), `main_class?`, `jvm_args?`, `port?`, `suspend?` | Compila e lanca a aplicacao Java com JDB |
| `debug/attach` | `host?`, `port` | Conecta a uma JVM ja rodando via JDWP |
| `debug/disconnect` | `terminate?` | Encerra a sessao de debug |

**Control:**

| Tool | Input | Descricao |
|------|-------|-----------|
| `debug/continue` | `thread_id?` | Retoma execucao ate proximo breakpoint/excecao |
| `debug/step_over` | `thread_id` | Executa proxima linha sem entrar em funcoes |
| `debug/step_into` | `thread_id`, `filter_jdk?` | Entra na proxima chamada de funcao |
| `debug/step_out` | `thread_id` | Sai da funcao atual |

**Breakpoints:**

| Tool | Input | Descricao |
|------|-------|-----------|
| `debug/breakpoint` | `action` (set/remove), `file`, `line`, `condition?`, `hit_count?` | Gerencia breakpoints (suporta condicionais) |
| `debug/catch` | `exception_class`, `caught?`, `uncaught?` | Configura catch de excecoes |

**Inspection:**

| Tool | Input | Descricao |
|------|-------|-----------|
| `debug/locals` | `thread_id`, `frame_index?`, `max_depth?` | Lista variaveis locais do frame |
| `debug/inspect` | `expression`, `thread_id`, `max_depth?` | Inspeciona objeto em profundidade |
| `debug/evaluate` | `expression`, `thread_id`, `frame_index?` | Avalia expressao Java no contexto |
| `debug/stacktrace` | `thread_id`, `max_frames?`, `filter_jdk?` | Retorna pilha de chamadas |
| `debug/threads` | `include_daemon?`, `include_system?` | Lista todas as threads da JVM |
| `debug/classes` | `filter?` | Lista classes carregadas na JVM |
| `debug/methods` | `class_name` | Lista metodos de uma classe |

**Source:**

| Tool | Input | Descricao |
|------|-------|-----------|
| `debug/source` | `file`, `line`, `context_lines?` | Le codigo-fonte com contexto ao redor |

## Desenvolvimento

### Testes

```bash
# MCP Server (96 testes)
cd packages/mcp-server
pnpm test

# TUI (97 testes)
cd packages/tui
cargo test
```

### Build

```bash
# MCP Server
cd packages/mcp-server
pnpm build        # tsc

# TUI
cd packages/tui
cargo build --release
```

## Estrutura do Projeto

```
glassbox/
├── package.json                    # Workspace root
├── pnpm-workspace.yaml
├── documentos/                     # Specs, ADRs, RFCs, diagramas
│   ├── glassbox-product-overview.md
│   ├── glassbox-adrs.md            # 8 Architecture Decision Records
│   ├── glassbox-rfcs.md            # 6 Request for Comments
│   ├── glassbox-observability-spec.md
│   └── *.mermaid                   # 5 diagramas de arquitetura
├── packages/
│   ├── mcp-server/                 # Servidor MCP (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts            # Entry point
│   │   │   ├── server.ts           # Configuracao do servidor MCP
│   │   │   ├── backends/           # Backend JDB (parser, protocolo JDWP)
│   │   │   ├── events/             # Event stream (21 tipos)
│   │   │   ├── session/            # Session manager, turn manager
│   │   │   ├── tools/              # 17 MCP tools (5 categorias)
│   │   │   └── tui-bridge.ts       # Bridge Unix socket para TUI
│   │   └── tests/                  # 96 testes (Vitest)
│   └── tui/                        # Interface TUI (Rust)
│       ├── src/
│       │   ├── lib.rs              # Library crate
│       │   ├── main.rs             # Binary crate (CLI)
│       │   ├── app.rs              # Estado da aplicacao
│       │   ├── input.rs            # Tratamento de teclas e comandos
│       │   ├── ui/                 # Paineis de renderizacao
│       │   │   ├── mod.rs          # Layout e composicao
│       │   │   ├── source_panel.rs # Painel de codigo-fonte
│       │   │   ├── variables_panel.rs
│       │   │   ├── agent_panel.rs
│       │   │   ├── syntax.rs       # Syntax highlighting Java
│       │   │   └── ...
│       │   ├── protocol/           # Parser JSONL, tipos, comandos
│       │   ├── layout.rs           # Calculo responsivo de layout
│       │   └── theme.rs            # Paleta de cores
│       └── tests/                  # 97 testes (cargo test)
│           ├── fixtures/           # 4 arquivos JSONL de sessoes
│           └── render_test.rs      # Testes de renderizacao
```

## Documentacao

A pasta `documentos/` contem a especificacao completa do projeto:

- **Product Overview** — Visao geral do produto e proposta de valor
- **ADRs** — 8 Architecture Decision Records (JDB como backend, Ratatui para TUI, etc.)
- **RFCs** — 6 Request for Comments (event stream, tool categories, control modes, etc.)
- **Observability Spec** — Especificacao dos 21 tipos de eventos
- **Diagramas Mermaid** — Arquitetura, fluxo de debug, event stream, tools, modos

## Inspiracao e Creditos

Este projeto foi inspirado pelo trabalho de **[Bruno Borges](https://github.com/brunoborges)** e seu projeto [jdb-agentic-debugger](https://github.com/brunoborges/jdb-agentic-debugger), que demonstrou o potencial de usar IA para controlar o JDB (Java Debugger) de forma autonoma. A ideia central — de que agentes de IA podem nao apenas analisar codigo, mas tambem **controlar a execucao** de um debugger para investigar bugs em tempo real — foi o ponto de partida para a construcao do GlassBox.

Veja o [post original](https://x.com/brunoborges/status/2023504791192617148) que resgatou essa abordagem e motivou a implementacao deste projeto para a comunidade.

## Licenca

MIT
