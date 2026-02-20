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

## Uso

### Configuracao no Claude Desktop

Adicione ao `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "glassbox": {
      "command": "node",
      "args": ["caminho/para/packages/mcp-server/dist/index.js", "--tui"],
      "env": {
        "GLASSBOX_TUI": "1"
      }
    }
  }
}
```

### Executando a TUI

**Modo Socket** (recomendado — bidirecional, permite enviar comandos):

```bash
# Auto-discovery do socket (busca /tmp/glassbox-*.sock)
glassbox-tui --input socket

# Ou especificando o caminho do socket
glassbox-tui --input socket --socket /tmp/glassbox-abc123.sock
```

**Modo Pipe** (somente leitura):

```bash
# Pipe de um arquivo JSONL
cat sessao.jsonl | glassbox-tui

# Pipe direto do stderr do MCP server
comando-mcp 2>&1 | glassbox-tui
```

### Variaveis de Ambiente

| Variavel | Valor | Descricao |
|----------|-------|-----------|
| `GLASSBOX_TUI` | `1` | Ativa a bridge TUI no MCP server |

### Hotkeys da TUI

| Tecla | Acao |
|-------|------|
| `Tab` | Alternar modo (Autonomous/Manual/Collaborative) |
| `1-4` | Selecionar painel ativo |
| `j/k` | Scroll ou selecao de variaveis |
| `/` | Abrir command prompt |
| `w` | Adicionar watch expression |
| `F5` | Continue (modo Manual) |
| `F6` | Step Over (modo Manual) |
| `F7` | Step Into (modo Manual) |
| `F8` | Step Out (modo Manual) |
| `y` | Aceitar fix proposto |
| `n` | Rejeitar fix proposto |
| `s` | Salvar relatorio |
| `q` | Sair |

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
