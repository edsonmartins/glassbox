# Glassbox — Debug Inteligente para JVM

> **O debugger que a IA controla e você observa.**
> MCP Server + TUI para debug autônomo de aplicações Java, Kotlin e Scala.

---

## O Problema

Debugar aplicações JVM hoje segue um ciclo frustrante:

1. Desenvolvedor copia stack trace / logs
2. Cola no chat da IA (2000+ tokens)
3. IA pede mais contexto
4. Desenvolvedor volta ao código, adiciona `println`, recompila
5. Repete 5-10 vezes até achar o bug
6. **~15-30 minutos. ~5000+ tokens desperdiçados.**

## A Solução: Glassbox

Glassbox dá à IA **acesso direto ao debugger JVM** via MCP (Model Context Protocol).
Em vez de parsear logs, a IA executa comandos de debug cirurgicamente:

```
Antes (tradicional):           Depois (Glassbox):
─────────────────────          ──────────────────────
Dev → copia logs               Dev → "Debug meu endpoint /api/pedidos"
Dev → cola no chat             IA  → attach ao processo
IA  → "me manda mais"          IA  → set breakpoint em NPE
Dev → add println              IA  → catch exception
Dev → recompila                IA  → inspeciona variáveis
Dev → reproduz bug             IA  → avalia expressões
Dev → copia output             IA  → propõe fix
Dev → cola no chat             
IA  → "acho que é isso"        Resultado:
                               3.2 segundos, 87 tokens, fix exato.
~15-30 min, ~5000 tokens       ~95% menos tokens, ~90% menos tempo
```

---

## Arquitetura

```mermaid
graph TB
    subgraph "Seu Terminal"
        TUI["🖥️ TUI / Web UI<br/><i>Observabilidade em tempo real</i>"]
    end

    subgraph "Glassbox Server"
        MCP["🔌 MCP Protocol<br/><i>JSON-RPC via stdio</i>"]
        CORE["⚙️ Debug Core<br/><i>API unificada</i>"]
        ES["📡 Event Stream<br/><i>Eventos tipados</i>"]
    end

    subgraph "Backends"
        JDB["☕ JDB<br/><i>Java / Kotlin / Scala</i>"]
        DAP_PY["🐍 debugpy<br/><i>Python</i>"]
        DAP_GO["🐹 Delve<br/><i>Go</i>"]
        DAP_RS["🦀 lldb-dap<br/><i>Rust / C / C++</i>"]
        DAP_JS["🟨 js-debug<br/><i>JavaScript / TS</i>"]
    end

    subgraph "Sua Aplicação"
        APP["🎯 JVM / Runtime<br/><i>O programa sendo debugado</i>"]
    end

    AI["🤖 IA (Claude, GPT, etc)<br/><i>Agente de debug</i>"]

    AI <-->|"MCP tools"| MCP
    MCP <--> CORE
    CORE <--> ES
    ES -->|"eventos"| TUI
    CORE <--> JDB
    CORE -.->|"futuro"| DAP_PY
    CORE -.->|"futuro"| DAP_GO
    CORE -.->|"futuro"| DAP_RS
    CORE -.->|"futuro"| DAP_JS
    JDB <-->|"JDWP"| APP

    style AI fill:#7c3aed,stroke:#5b21b6,color:#fff
    style TUI fill:#0ea5e9,stroke:#0284c7,color:#fff
    style MCP fill:#f59e0b,stroke:#d97706,color:#000
    style CORE fill:#f59e0b,stroke:#d97706,color:#000
    style ES fill:#f59e0b,stroke:#d97706,color:#000
    style JDB fill:#22c55e,stroke:#16a34a,color:#000
    style APP fill:#ef4444,stroke:#dc2626,color:#fff
    style DAP_PY fill:#374151,stroke:#6b7280,color:#9ca3af
    style DAP_GO fill:#374151,stroke:#6b7280,color:#9ca3af
    style DAP_RS fill:#374151,stroke:#6b7280,color:#9ca3af
    style DAP_JS fill:#374151,stroke:#6b7280,color:#9ca3af
```

---

## MCP Tools Disponíveis

A IA acessa o debugger através de **tools MCP padronizadas**:

```mermaid
graph LR
    subgraph "🚀 Lifecycle"
        launch["debug/launch"]
        attach["debug/attach"]
        disconnect["debug/disconnect"]
    end

    subgraph "🎯 Control"
        cont["debug/continue"]
        step_over["debug/step_over"]
        step_into["debug/step_into"]
        step_out["debug/step_out"]
    end

    subgraph "📍 Breakpoints"
        bp_set["debug/breakpoint"]
        bp_catch["debug/catch"]
        bp_cond["debug/conditional_bp"]
    end

    subgraph "🔍 Inspection"
        locals["debug/locals"]
        inspect["debug/inspect"]
        eval["debug/evaluate"]
        stack["debug/stacktrace"]
        threads["debug/threads"]
    end

    subgraph "📊 Info"
        source["debug/source"]
        classes["debug/classes"]
        methods["debug/methods"]
    end

    style launch fill:#22c55e,stroke:#16a34a,color:#000
    style attach fill:#22c55e,stroke:#16a34a,color:#000
    style cont fill:#0ea5e9,stroke:#0284c7,color:#fff
    style step_over fill:#0ea5e9,stroke:#0284c7,color:#fff
    style step_into fill:#0ea5e9,stroke:#0284c7,color:#fff
    style step_out fill:#0ea5e9,stroke:#0284c7,color:#fff
    style bp_set fill:#f59e0b,stroke:#d97706,color:#000
    style bp_catch fill:#f59e0b,stroke:#d97706,color:#000
    style bp_cond fill:#f59e0b,stroke:#d97706,color:#000
    style locals fill:#a855f7,stroke:#9333ea,color:#fff
    style inspect fill:#a855f7,stroke:#9333ea,color:#fff
    style eval fill:#a855f7,stroke:#9333ea,color:#fff
    style stack fill:#a855f7,stroke:#9333ea,color:#fff
    style threads fill:#a855f7,stroke:#9333ea,color:#fff
    style source fill:#6b7280,stroke:#4b5563,color:#fff
    style classes fill:#6b7280,stroke:#4b5563,color:#fff
    style methods fill:#6b7280,stroke:#4b5563,color:#fff
```

### Exemplo de Chamada MCP

```json
// IA chama: debug/evaluate
{
  "method": "tools/call",
  "params": {
    "name": "debug/evaluate",
    "arguments": {
      "expression": "clienteRepo.findById(999)",
      "thread": "http-nio-8080-exec-1",
      "frame": 0
    }
  }
}

// Glassbox responde:
{
  "content": [{
    "type": "text",
    "text": "{\"type\": \"java.util.Optional\", \"value\": \"Optional.empty\"}"
  }]
}
```

---

## Fluxo de Debug: IA Encontra um NPE

```mermaid
sequenceDiagram
    participant Dev as 👨‍💻 Desenvolvedor
    participant AI as 🤖 IA (Claude)
    participant GB as ⚙️ Glassbox
    participant JVM as ☕ JVM

    Dev->>AI: "Debug /api/pedidos, tá dando NPE"
    AI->>GB: debug/launch (Maven, -agentlib:jdwp)
    GB->>JVM: Inicia processo com JDWP
    GB-->>AI: ✅ Processo iniciado, pid 12345

    AI->>GB: debug/catch NullPointerException
    GB->>JVM: Set exception breakpoint
    GB-->>AI: ✅ Breakpoint configurado

    AI->>GB: debug/continue
    GB-->>Dev: 📡 [TUI] App rodando, aguardando exceção...

    Note over Dev: Dev faz request<br/>POST /api/pedidos

    JVM-->>GB: ⚡ NPE em PedidoService.java:47
    GB-->>AI: exception_caught (NPE, line 47)
    GB-->>Dev: 📡 [TUI] NPE capturada! IA investigando...

    AI->>GB: debug/stacktrace
    GB-->>AI: 5 frames (criarPedido:47 → ...)

    AI->>GB: debug/locals
    GB-->>AI: dto={clienteId=999}, cliente=null

    AI->>GB: debug/evaluate "clienteRepo.findById(999)"
    GB-->>AI: Optional.empty

    Note over AI: IA raciocina:<br/>cliente=null porque<br/>findById retornou empty<br/>e .orElse(null) converteu

    AI-->>Dev: 🐛 Bug: .orElse(null) → .orElseThrow()
    GB-->>Dev: 📡 [TUI] Fix proposto com diff

    Dev->>Dev: [A] Aplicar fix ✅
```

---

## Modos de Operação

```mermaid
stateDiagram-v2
    [*] --> Autonomo: Sessão iniciada

    Autonomo: 🤖 IA Autônoma (Default)
    Autonomo: IA investiga, dev observa

    Manual: 🧑 Controle Manual
    Manual: Dev dirige, IA sugere

    Colaborativo: 🤝 Colaborativo
    Colaborativo: Ambos agem, turno compartilhado

    Autonomo --> Manual: Dev pressiona [R]
    Manual --> Autonomo: Dev pressiona [R]
    Autonomo --> Colaborativo: Dev seta breakpoint
    Manual --> Colaborativo: IA pede permissão
    Colaborativo --> Autonomo: Dev devolve controle
    Colaborativo --> Manual: IA pausa ações
```

| Modo | Quem controla | Quando usar |
|------|--------------|-------------|
| **Autônomo** | IA lidera, dev observa | Bug report simples, IA resolve sozinha |
| **Manual** | Dev lidera, IA comenta | Dev sabe onde está o bug, quer explorar |
| **Colaborativo** | Ambos agem | Bugs complexos, exploração conjunta |

---

## Event Stream

Cada ação gera um evento tipado (JSON) que alimenta TUI e Web UI simultaneamente:

```mermaid
flowchart LR
    subgraph Sources
        DBG["Debugger<br/>JDB/JDWP"]
        AGT["IA Agent<br/>via MCP"]
        USR["Developer<br/>via TUI"]
    end

    ES["📡 Event Stream<br/>Eventos tipados JSON"]

    subgraph Consumers
        TUI["🖥️ TUI<br/>Terminal"]
        WEB["🌐 Web UI<br/>Browser"]
        LOG["📝 Log<br/>Arquivo"]
    end

    DBG -->|"exception_caught<br/>breakpoint_hit<br/>thread_started"| ES
    AGT -->|"agent_action<br/>diagnosis<br/>fix_proposed"| ES
    USR -->|"control_change<br/>manual_step<br/>watch_added"| ES

    ES --> TUI
    ES --> WEB
    ES --> LOG
```

### Tipos de Evento

| Tipo | Source | Descrição |
|------|--------|-----------|
| `exception_caught` | debugger | Exceção atingiu breakpoint |
| `breakpoint_hit` | debugger | Breakpoint de linha atingido |
| `agent_action` | ai | IA executou uma tool MCP |
| `diagnosis` | ai | IA formulou diagnóstico |
| `fix_proposed` | ai | IA propôs correção com diff |
| `control_change` | user/ai | Troca de quem controla o debugger |
| `manual_step` | user | Dev executou step/eval manualmente |

---

## Roadmap

```mermaid
gantt
    title Glassbox — Roadmap de Desenvolvimento
    dateFormat YYYY-MM-DD
    axisFormat %b %Y

    section v0.1 — Foundation
    MCP Server básico (JDB)           :done, f1, 2025-02-01, 30d
    Tools: launch, breakpoint, locals  :done, f2, after f1, 20d
    Spec de observabilidade            :done, f3, after f1, 10d

    section v0.2 — Observabilidade
    TUI com Ratatui (Rust)             :active, o1, 2025-04-01, 30d
    Event Stream tipado                :o2, after o1, 15d
    Session Summary e métricas         :o3, after o2, 10d

    section v0.3 — Multi-backend
    DAP Protocol adapter               :m1, 2025-06-01, 30d
    Backend Python (debugpy)           :m2, after m1, 20d
    Backend Go (Delve)                 :m3, after m2, 20d

    section v0.4 — Web UI
    Web dashboard (React)              :w1, 2025-09-01, 30d
    Diff viewer e apply fix            :w2, after w1, 15d
    Colaboração em tempo real          :w3, after w2, 20d

    section v1.0 — Produção
    npm publish + pip install           :p1, 2025-12-01, 15d
    Documentação completa               :p2, after p1, 15d
    Launch público                      :milestone, p3, after p2, 0d
```

---

## Stack Tecnológico

| Componente | Tecnologia | Por quê |
|------------|-----------|---------|
| **MCP Server** | TypeScript (Node.js) | SDK oficial MCP, ecossistema maduro |
| **Debug Core** | TypeScript | Abstração sobre JDB/DAP |
| **JDB Backend** | JDB via child_process | Nativo da JVM, zero dependências |
| **TUI** | Rust + Ratatui | Performance, visual rico no terminal |
| **Web UI** | React + Tailwind | Para quem prefere browser |
| **Event Stream** | JSON over stdio/SSE | Simples, extensível, streamable |

---

## Quick Start (Futuro)

```bash
# Instalar
npm install -g @glassbox/mcp-server

# Usar com Claude Code
claude --mcp glassbox

# Ou configurar no claude_desktop_config.json
{
  "mcpServers": {
    "glassbox": {
      "command": "npx",
      "args": ["-y", "@glassbox/mcp-server"]
    }
  }
}
```

```bash
# Debug direto
Dev: "Debug meu PedidoService, tá dando NullPointerException"
# A IA faz o resto. Você assiste na TUI.
```

---

## Comparativo

| | Printf Debug | Log no Chat | **Glassbox** |
|---|---|---|---|
| **Tokens** | 0 (sem IA) | ~2000-5000 | **~87** |
| **Tempo** | 15-30 min | 10-20 min | **~3 seg** |
| **Precisão** | Depende do dev | Depende do contexto | **Cirúrgica** |
| **Recompilação** | 5-10 ciclos | 0 | **0** |
| **Custo** | Tempo do dev | $0.05-0.15 | **$0.003** |
| **IA vê estado real** | ❌ | ❌ (só texto) | **✅ (live)** |

---

## Licença

MIT — Open source, use como quiser.

---

*Glassbox: Porque debug não deveria ser um jogo de adivinhação.*
