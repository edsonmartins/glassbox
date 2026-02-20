# Glassbox — Especificação de Observabilidade Compartilhada

## O Princípio Fundamental

O desenvolvedor e a IA precisam ter **visão simultânea** do mesmo estado de debug.
Mas com papéis diferentes:

```
IA (agente):     Envia comandos → Recebe JSON estruturado → Raciocina → Próximo comando
Desenvolvedor:   Observa o fluxo → Vê o código → Vê variáveis → Intervém quando quer
```

A interface do desenvolvedor NÃO é um terminal JDB. É um **painel de controle**
que mostra o estado do programa E o que a IA está fazendo com ele.

---

## Interface TUI: O Desenvolvedor Vê Isso no Terminal

### Estado 1: Sessão Iniciada, Esperando Breakpoint

```
╔══ Glassbox ══ com.example.PedidoService ═══════════════════════ 14:32:01 ══╗
║                                                                           ║
║  ┌─ Source ─────────────────────────────────────────────────────────────┐  ║
║  │                                                                     │  ║
║  │   42 │     public PedidoResponse criarPedido(PedidoDTO dto) {       │  ║
║  │   43 │         Cliente cliente = clienteRepo                        │  ║
║  │   44 │             .findById(dto.getClienteId())                    │  ║
║  │   45 │             .orElse(null);                                   │  ║
║  │   46 │                                                              │  ║
║  │   47 │         String nome = cliente.getNome();  // ← NPE aqui     │  ║
║  │   48 │         BigDecimal total = calcularTotal(dto.getItens());    │  ║
║  │   49 │         Pedido pedido = new Pedido(cliente, total);          │  ║
║  │   50 │         return pedidoRepo.save(pedido).toResponse();         │  ║
║  │   51 │     }                                                        │  ║
║  │                                                                     │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ Variables ────────────────┐  ┌─ AI Agent ──────────────────────────┐  ║
║  │                            │  │                                     │  ║
║  │  (aguardando breakpoint)   │  │  ● Sessão ativa                    │  ║
║  │                            │  │  ⏳ Aguardando exceção...           │  ║
║  │                            │  │                                     │  ║
║  │                            │  │  Breakpoints ativos:                │  ║
║  │                            │  │   ◆ catch NullPointerException      │  ║
║  │                            │  │   ◆ catch IllegalArgumentException  │  ║
║  │                            │  │                                     │  ║
║  └────────────────────────────┘  └─────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ Event Log ─────────────────────────────────────────────────────────┐  ║
║  │  14:32:01  🤖 Claude: debug/launch PedidoService (Maven, -g)       │  ║
║  │  14:32:03  🤖 Claude: debug/catch NullPointerException              │  ║
║  │  14:32:03  🤖 Claude: debug/catch IllegalArgumentException          │  ║
║  │  14:32:04  🤖 Claude: debug/continue                               │  ║
║  │  14:32:04  ▶  Aplicação rodando em http://localhost:8080            │  ║
║  │  14:32:04  ⏳ Esperando exceção ser lançada...                      │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  [F5] Continue  [F9] Breakpoint  [F10] Step Over  [F11] Into  [F12] Out  ║
║  [Tab] Trocar painel  [/] Comando  [q] Sair  [?] Ajuda                   ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Estado 2: Exceção Capturada — IA Investigando

```
╔══ Glassbox ══ com.example.PedidoService ═══════════════════════ 14:33:15 ══╗
║                                                                           ║
║  ┌─ Source ─── PedidoService.java ──────────────────── line 47 ─────────┐ ║
║  │                                                                     │  ║
║  │   42 │     public PedidoResponse criarPedido(PedidoDTO dto) {       │  ║
║  │   43 │         Cliente cliente = clienteRepo                        │  ║
║  │   44 │             .findById(dto.getClienteId())                    │  ║
║  │   45 │             .orElse(null);                                   │  ║
║  │   46 │                                                              │  ║
║  │ ▸ 47 │         String nome = cliente.getNome();  ⚡ NPE             │  ║
║  │   48 │         BigDecimal total = calcularTotal(dto.getItens());    │  ║
║  │   49 │         Pedido pedido = new Pedido(cliente, total);          │  ║
║  │   50 │         return pedidoRepo.save(pedido).toResponse();         │  ║
║  │   51 │     }                                                        │  ║
║  │                                                                     │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ Variables ────────────────┐  ┌─ AI Agent ──────────────────────────┐  ║
║  │                            │  │                                     │  ║
║  │  dto = PedidoDTO {         │  │  🔍 Investigando NPE na linha 47   │  ║
║  │    clienteId = 999         │  │                                     │  ║
║  │    itens = ArrayList(3)    │  │  Hipótese: cliente é null           │  ║
║  │  }                         │  │  → findById retornou empty          │  ║
║  │  cliente = null ⚠️         │  │  → orElse(null) produziu null      │  ║
║  │  nome = (not yet loaded)   │  │                                     │  ║
║  │                            │  │  Próximo passo: verificar se        │  ║
║  │                            │  │  clienteId=999 existe no banco      │  ║
║  │                            │  │                                     │  ║
║  └────────────────────────────┘  └─────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ Call Stack ───────────────┐  ┌─ Threads ───────────────────────────┐  ║
║  │  ▸ criarPedido:47          │  │  ▸ http-nio-8080-exec-1 [stopped]  │  ║
║  │    invoke0 (native)        │  │    http-nio-8080-exec-2 [running]  │  ║
║  │    invoke:77               │  │    main [waiting]                   │  ║
║  │    handleRequest:142       │  │    GC Thread [daemon]              │  ║
║  │    doDispatch:1067         │  │                                     │  ║
║  └────────────────────────────┘  └─────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ Event Log ─────────────────────────────────────────────────────────┐  ║
║  │  14:33:15  ⚡ NullPointerException em PedidoService.java:47         │  ║
║  │  14:33:15  🤖 Claude: debug/stacktrace                             │  ║
║  │  14:33:15  🤖 Claude: debug/locals → dto, cliente=null             │  ║
║  │  14:33:16  🤖 Claude: debug/inspect dto.getClienteId() → 999      │  ║
║  │  14:33:16  🤖 Claude: debug/evaluate clienteRepo.findById(999)     │  ║
║  │            → Optional.empty                                         │  ║
║  │  14:33:16  🐛 Bug confirmado: cliente 999 não existe no banco      │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  [F5] Continue  [F9] Breakpoint  [F10] Step Over  [F11] Into  [F12] Out  ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Estado 3: IA Encontrou o Bug — Apresentando Solução

```
╔══ Glassbox ══ com.example.PedidoService ═══════════════════════ 14:33:18 ══╗
║                                                                           ║
║  ┌─ Source ─── PedidoService.java ──── DIFF MODE ──────────────────────┐  ║
║  │                                                                     │  ║
║  │   42 │     public PedidoResponse criarPedido(PedidoDTO dto) {       │  ║
║  │   43 │-        Cliente cliente = clienteRepo                        │  ║
║  │   44 │-            .findById(dto.getClienteId())                    │  ║
║  │   45 │-            .orElse(null);                                   │  ║
║  │   46 │-                                                             │  ║
║  │   47 │-        String nome = cliente.getNome();                     │  ║
║  │   43 │+        Cliente cliente = clienteRepo                        │  ║
║  │   44 │+            .findById(dto.getClienteId())                    │  ║
║  │   45 │+            .orElseThrow(() ->                               │  ║
║  │   46 │+                new ClienteNotFoundException(                │  ║
║  │   47 │+                    dto.getClienteId()));                    │  ║
║  │   48 │+                                                             │  ║
║  │   49 │+        String nome = cliente.getNome();                     │  ║
║  │                                                                     │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ AI Diagnosis ──────────────────────────────────────────────────────┐  ║
║  │                                                                     │  ║
║  │  🐛 BUG: NullPointerException em PedidoService.java:47             │  ║
║  │                                                                     │  ║
║  │  Causa raiz: clienteRepo.findById(999) retorna Optional.empty.     │  ║
║  │  O código usa .orElse(null), que permite null fluir para            │  ║
║  │  cliente.getNome() na linha 47.                                     │  ║
║  │                                                                     │  ║
║  │  Fix: Trocar .orElse(null) por .orElseThrow() com exceção          │  ║
║  │  específica. Isso fail-fast com mensagem clara em vez de NPE.      │  ║
║  │                                                                     │  ║
║  │  Impacto: Qualquer request com clienteId inválido causa NPE.       │  ║
║  │  Severidade: 🔴 ALTA — afeta todos os endpoints de pedido.         │  ║
║  │                                                                     │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  ┌─ Event Log ─────────────────────────────────────────────────────────┐  ║
║  │  14:33:16  🐛 Bug confirmado: cliente 999 não existe no banco      │  ║
║  │  14:33:17  🤖 Claude: analisando padrão do bug...                  │  ║
║  │  14:33:18  📋 Claude: fix proposto (diff acima)                    │  ║
║  │  14:33:18  ✅ Sessão de debug completa — 3.2s, 87 tokens usados   │  ║
║  └─────────────────────────────────────────────────────────────────────┘  ║
║                                                                           ║
║  [A] Aplicar fix  [D] Descartar  [E] Editar fix  [C] Continuar debug    ║
╚═══════════════════════════════════════════════════════════════════════════╝
```

### Estado 4: Desenvolvedor Intervém (Modo Híbrido)

O desenvolvedor pode a qualquer momento tomar controle:

```
╔══ Glassbox ══ com.example.PedidoService ══ 🧑 CONTROLE MANUAL ═ 14:34:02 ══╗
║                                                                             ║
║  ┌─ Source ─── PedidoService.java ──────────────────── line 48 ───────────┐ ║
║  │                                                                       │  ║
║  │   45 │             .orElse(null);                                     │  ║
║  │   46 │                                                                │  ║
║  │   47 │         String nome = cliente.getNome();                       │  ║
║  │ ▸ 48 │         BigDecimal total = calcularTotal(dto.getItens());      │  ║
║  │   49 │         Pedido pedido = new Pedido(cliente, total);            │  ║
║  │   50 │         return pedidoRepo.save(pedido).toResponse();           │  ║
║  │   51 │     }                                                          │  ║
║  │                                                                       │  ║
║  └───────────────────────────────────────────────────────────────────────┘  ║
║                                                                             ║
║  ┌─ Variables ────────────────┐  ┌─ Watch Expressions ─────────────────┐   ║
║  │                            │  │                                     │   ║
║  │  dto.clienteId = 999       │  │  dto.getItens().size() = 3          │   ║
║  │  cliente = null ⚠️         │  │  calcularTotal(dto.getItens())      │   ║
║  │  nome = (exception)        │  │    → (not yet evaluated)            │   ║
║  │  total = (not yet loaded)  │  │                                     │   ║
║  │                            │  │  [+ Adicionar expressão]            │   ║
║  │                            │  │                                     │   ║
║  └────────────────────────────┘  └─────────────────────────────────────┘   ║
║                                                                             ║
║  ┌─ Command ───────────────────────────────────────────────────────────┐   ║
║  │  glassbox> eval dto.getItens().stream()                               │   ║
║  │            .mapToDouble(i -> i.getPreco().doubleValue())             │   ║
║  │            .sum()                                                    │   ║
║  │  → 1547.90                                                          │   ║
║  │                                                                     │   ║
║  │  glassbox> _                                                          │   ║
║  └─────────────────────────────────────────────────────────────────────┘   ║
║                                                                             ║
║  ┌─ Event Log ─────────────────────────────────────────────────────────┐   ║
║  │  14:34:00  🧑 Dev assumiu controle manual                           │   ║
║  │  14:34:00  🤖 Claude: pausado (dev no controle)                     │   ║
║  │  14:34:01  🧑 Dev: step over → linha 48                             │   ║
║  │  14:34:02  🧑 Dev: eval dto.getItens().stream()... → 1547.90       │   ║
║  │                                                                     │   ║
║  │  💡 Claude observa: "Posso ajudar com algo? Pressione [R] para     │   ║
║  │     me devolver o controle"                                         │   ║
║  └─────────────────────────────────────────────────────────────────────┘   ║
║                                                                             ║
║  🧑 MANUAL  [R] Devolver p/ IA  [F10] Step  [F11] Into  [/] Comando      ║
╚═════════════════════════════════════════════════════════════════════════════╝
```

---

## Event Stream: O Formato dos Dados

Cada ação gera um evento tipado que alimenta tanto a TUI quanto a Web UI:

```json
{
  "timestamp": "2025-02-17T14:33:15.123Z",
  "type": "exception_caught",
  "source": "debugger",
  "data": {
    "exception": "java.lang.NullPointerException",
    "location": {
      "file": "PedidoService.java",
      "line": 47,
      "class": "com.example.PedidoService",
      "method": "criarPedido"
    },
    "thread": "http-nio-8080-exec-1",
    "message": null
  }
}

{
  "timestamp": "2025-02-17T14:33:15.234Z",
  "type": "agent_action",
  "source": "ai",
  "data": {
    "tool": "debug/locals",
    "request": {},
    "result": {
      "variables": [
        {"name": "dto", "type": "PedidoDTO", "value": "{clienteId=999, itens=ArrayList(3)}"},
        {"name": "cliente", "type": "Cliente", "value": "null"},
        {"name": "nome", "type": "String", "value": "(not yet loaded)"}
      ]
    },
    "tokens_used": 42
  }
}

{
  "timestamp": "2025-02-17T14:33:16.456Z",
  "type": "agent_action",
  "source": "ai",
  "data": {
    "tool": "debug/evaluate",
    "request": {"expression": "clienteRepo.findById(999)"},
    "result": {
      "type": "java.util.Optional",
      "value": "Optional.empty"
    },
    "tokens_used": 38
  }
}

{
  "timestamp": "2025-02-17T14:33:17.789Z",
  "type": "diagnosis",
  "source": "ai",
  "data": {
    "bug_id": "NPE-001",
    "severity": "HIGH",
    "title": "NullPointerException por cliente inexistente",
    "root_cause": "findById(999) retorna Optional.empty, .orElse(null) permite null",
    "affected_line": 47,
    "fix": {
      "type": "code_change",
      "file": "PedidoService.java",
      "diff": "..."
    },
    "total_tokens": 87,
    "elapsed_ms": 3200
  }
}

{
  "timestamp": "2025-02-17T14:34:00.000Z",
  "type": "control_change",
  "source": "user",
  "data": {
    "from": "ai",
    "to": "user",
    "reason": "manual_takeover"
  }
}
```

---

## Modos de Operação

### Modo 1: IA Autônoma (Default)
O desenvolvedor observa. A IA investiga.
```
Dev: "Debug meu endpoint /api/pedidos — tá dando NPE"
IA: assume controle total do debugger
Dev: assiste na TUI em tempo real
Dev: pode intervir a qualquer momento (hotkeys)
```

### Modo 2: Controle Manual
O desenvolvedor dirige. A IA observa e sugere.
```
Dev: pressiona [R] ou usa hotkeys para tomar controle
Dev: step, inspect, evaluate via TUI
IA: observa e oferece insights ("Essa variável parece suspeita...")
Dev: devolve controle quando quiser
```

### Modo 3: Colaborativo
Ambos podem agir. Turno compartilhado.
```
Dev: seta breakpoint na linha 50
IA: seta breakpoint na linha 80
Ambos: veem quando qualquer breakpoint é atingido
Dev: inspeciona variáveis que quer ver
IA: inspeciona variáveis para sua análise
Ambos: veem tudo no mesmo painel
```

---

## Métricas Exibidas ao Desenvolvedor

### Token Counter (canto superior)
```
Tokens: 87 usados │ ~$0.003 │ Economia vs log: ~95%
```
Isso é CRUCIAL para o Edson — mostra concretamente quanto está economizando
vs o approach de "colar logs no chat".

### Timeline (parte inferior)
```
14:33:15 ──────●──────●──────●──────●──────●────── 14:33:18
               │      │      │      │      │
              NPE   stack  locals inspect  fix
              caught trace         eval   proposto

Duração total: 3.2s │ 6 tool calls │ 87 tokens
```

### Session Summary (ao final)
```
╔═══════════════════════════════════════════════════════╗
║  📊 Debug Session Summary                             ║
║                                                       ║
║  Duração:        3.2 segundos                        ║
║  Tool calls:     6                                   ║
║  Tokens usados:  87                                  ║
║  Custo estimado: $0.003                              ║
║                                                       ║
║  vs Approach tradicional (estimativa):               ║
║    - println debug: ~5 ciclos × recompilação         ║
║    - Log no chat:   ~2000+ tokens para parsear       ║
║    - Tempo:         ~15-30 minutos                   ║
║                                                       ║
║  Economia: ~95% tokens, ~90% tempo                   ║
║                                                       ║
║  Bugs encontrados: 1                                 ║
║    🐛 NPE-001: cliente null em PedidoService:47      ║
║       Fix: .orElse(null) → .orElseThrow()            ║
║       Status: ✅ Proposto (aguardando aprovação)     ║
║                                                       ║
║  [A] Aplicar fixes  [S] Salvar relatório  [Q] Sair  ║
╚═══════════════════════════════════════════════════════╝
```
