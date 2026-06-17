import type { UIMessage } from '@ai-sdk/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexAppServerEvent, CodexSessionOptions } from '../types'
import { invoke } from '@tauri-apps/api/core'
import {
  approveCodexAppServerAction,
  buildCodexSessionOptions,
  clearCodexAppServerChatSessionsForTests,
  getCodexAppServerRuntimeLogs,
  runCodexExec,
  runCodexCliDebug,
  runCodexCliCloud,
  runCodexCliAppServer,
  runCodexCliDoctor,
  runCodexCliFeatures,
  runCodexCliHelp,
  runCodexCliPlugin,
  runCodexCliReview,
  runCodexCliCommand,
  runCodexCliApp,
  runCodexCliMcp,
  runCodexCliMcpServer,
  runCodexCliArchive,
  runCodexCliUnarchive,
  runCodexCliFork,
  runCodexCliResume,
  runCodexCliSandbox,
  runCodexCliUpdate,
  runCodexCliExecServer,
  runCodexCliProto,
  runCodexCliRemoteControl,
  runCodexLogout,
  runCodexVersion,
  sendCodexAppServerChatMessage,
  startCodexReview,
  steerCodexSubThread,
  steerCodexSubThreadEvents,
} from '../chat-backend'

const mockRuntimePermission = vi.hoisted(() => ({
  requestPermission: vi.fn(),
}))

const mockCodexUserInput = vi.hoisted(() => ({
  requestUserInput: vi.fn(async () => ({})),
}))

const mockAppState = vi.hoisted(() => ({
  updatePromptProgress: vi.fn(),
  updateLoadingModel: vi.fn(),
  updateThreadPromptProgress: vi.fn(),
  updateThreadLoadingModel: vi.fn(),
  setCurrentStreamThreadId: vi.fn(),
  setServerStatus: vi.fn(),
}))

const mockGlobalRuntime = vi.hoisted(() => ({
  client: null as {
    shutdownCodex: ReturnType<typeof vi.fn>
  } | null,
  processSignature: '',
  applyCodexRuntimeOptions: vi.fn(async () => {}),
}))

const mockSessionState = vi.hoisted(() => ({
  instances: [] as Array<{
    sendToCodex: ReturnType<typeof vi.fn>
    approveAction: ReturnType<typeof vi.fn>
    interruptTurn: ReturnType<typeof vi.fn>
    shutdownCodex: ReturnType<typeof vi.fn>
    setThreadOptions: ReturnType<typeof vi.fn>
    startCodexSession: ReturnType<typeof vi.fn>
    reloadUserConfig: ReturnType<typeof vi.fn>
  }>,
  constructorParams: [] as unknown[],
  serverEvents: [] as CodexAppServerEvent[],
  approvalRequest: {
    id: 'approval-1',
    method: 'item/commandExecution/requestApproval',
    params: {
      command: 'npm test',
      cwd: '/repo',
      reason: 'Run test suite',
    },
  } as {
    id: string
    method: string
    params?: unknown
  },
}))

const mockThreadsState = vi.hoisted(() => ({
  threads: {
    'thread-1': { id: 'thread-1', title: 'Thread 1', metadata: {} },
  } as Record<
    string,
    {
      id: string
      title?: string
      metadata?: Record<string, unknown>
      updated?: number
    }
  >,
  updateThread: vi.fn(),
}))

const mockWorkspaceState = vi.hoisted(() => ({
  directories: new Map<string, string>(),
  calls: [] as unknown[],
}))

const mockMcpServersState = vi.hoisted(() => ({
  mcpServers: {} as Record<
    string,
    {
      command: string
      args: string[]
      env: Record<string, string>
      active?: boolean
      type?: 'stdio' | 'http' | 'sse'
      url?: string
    }
  >,
  settings: {
    toolCallTimeoutSeconds: 30,
    baseRestartDelayMs: 1000,
    maxRestartDelayMs: 30000,
    backoffMultiplier: 2,
    enableSmartToolRouting: true,
    useLightweightRouterModel: false,
    routerModelProvider: '',
    routerModelId: '',
  },
}))

const mockProfilesState = vi.hoisted(() => ({
  profiles: {} as Record<string, any>,
  activeProfileId: null as string | null,
}))

vi.mock('@/stores/codex-provider-profile-store', () => ({
  useCodexProviderProfiles: {
    getState: () => mockProfilesState,
  },
}))

const mockModelProviderState = vi.hoisted(() => ({
  providers: [] as any[],
  getProviderByName: (name: string) => {
    return mockModelProviderState.providers.find((p) => p.provider === name)
  },
}))

const mockServiceHubState = vi.hoisted(() => ({
  mcpCallTool: vi.fn(),
  startModel: vi.fn(),
  getServerStatus: vi.fn(),
  startServer: vi.fn(),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => mockModelProviderState,
  },
}))

const mockProviderRemoteAuthKeyChain = vi.hoisted(() => vi.fn())

vi.mock('@/lib/provider-api-keys', () => ({
  providerRemoteAuthKeyChain: mockProviderRemoteAuthKeyChain,
}))

vi.mock('@/hooks/useLocalApiServer', () => ({
  useLocalApiServer: {
    getState: () => ({
      serverHost: '127.0.0.1',
      serverPort: 1337,
      apiPrefix: '/v1',
      apiKey: 'jan-local-api-key',
      trustedHosts: ['localhost'],
      corsEnabled: true,
      verboseLogs: true,
      proxyTimeout: 600,
      setServerPort: vi.fn(),
    }),
  },
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    app: () => ({
      getServerStatus: mockServiceHubState.getServerStatus,
    }),
    models: () => ({
      startModel: mockServiceHubState.startModel,
    }),
    mcp: () => ({
      callTool: mockServiceHubState.mcpCallTool,
    }),
  }),
}))

vi.mock('@/hooks/useMCPServers', () => ({
  useMCPServers: { getState: () => mockMcpServersState },
}))

vi.mock('@/stores/runtime-permission-store', () => ({
  useRuntimePermission: {
    getState: () => mockRuntimePermission,
  },
}))

vi.mock('@/stores/codex-user-input-store', () => ({
  useCodexUserInput: {
    getState: () => mockCodexUserInput,
  },
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: {
    getState: () => ({
      ...mockAppState,
      currentStreamThreadId: 'thread-1',
    }),
  },
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({
      threads: mockThreadsState.threads,
      updateThread: mockThreadsState.updateThread,
    }),
  },
}))

vi.mock('@/stores/workspace-directory-store', () => ({
  useWorkspaceDirectories: {
    getState: () => ({
      getDirectory: (input: { type: string; id: string; label: string }) => {
        mockWorkspaceState.calls.push(input)
        return mockWorkspaceState.directories.get(`${input.type}:${input.id}`)
      },
    }),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === 'exists_sync') return true
    return {}
  }),
}))

vi.mock('../tauri-process', () => ({
  TauriCodexProcessSpawner: class {},
}))

vi.mock('../global-codex-runtime', async () => {
  const { buildCodexProcessSignature, buildCodexRuntimeSignature } =
    await vi.importActual<typeof import('../global-codex-runtime')>(
      '../global-codex-runtime'
    )

  return {
    GLOBAL_CODEX_APP_SERVER_SESSION_ID: 'jan-global-codex-app-server',
    buildCodexProcessSignature,
    buildCodexRuntimeSignature,
    getGlobalCodexClientOrNull: () => mockGlobalRuntime.client,
    ensureGlobalCodexAppServer: vi.fn(async (spawnOptions: CodexSessionOptions) => {
      const processSignature = buildCodexProcessSignature(spawnOptions)
      if (
        mockGlobalRuntime.client &&
        mockGlobalRuntime.processSignature === processSignature
      ) {
        return mockGlobalRuntime.client
      }

      if (mockGlobalRuntime.client) {
        await mockGlobalRuntime.client.shutdownCodex()
      }

      const { CodexAppServerClient } = await import('../api')
      mockGlobalRuntime.client = new CodexAppServerClient({
        spawner: {},
        options: spawnOptions,
      })
      mockGlobalRuntime.processSignature = processSignature
      return mockGlobalRuntime.client
    }),
    applyCodexRuntimeOptions: mockGlobalRuntime.applyCodexRuntimeOptions,
    shutdownGlobalCodexAppServer: vi.fn(async () => {
      mockGlobalRuntime.client = null
      mockGlobalRuntime.processSignature = ''
    }),
    clearGlobalCodexThreadBinding: vi.fn(),
    resetGlobalCodexRuntimeForTests: vi.fn(() => {
      mockGlobalRuntime.client = null
      mockGlobalRuntime.processSignature = ''
      mockGlobalRuntime.applyCodexRuntimeOptions.mockClear()
    }),
  }
})

vi.mock('../api', () => ({
  CodexAppServerClient: class {
    sendToCodex = vi.fn(async function* () {
      const events: CodexAppServerEvent[] =
        mockSessionState.serverEvents.length > 0
          ? mockSessionState.serverEvents
          : [
              {
                type: 'approval_request',
                request: mockSessionState.approvalRequest,
              },
              {
                type: 'turn_completed',
                threadId: 'codex-thread-1',
                turnId: 'turn-1',
                turn: { id: 'turn-1', status: 'completed' },
              },
            ]

      for (const event of events) {
        yield event
      }
    })
    approveAction = vi.fn()
    interruptTurn = vi.fn()
    shutdownCodex = vi.fn()
    setThreadOptions = vi.fn()
    seedCodexThreadBinding = vi.fn()
    startCodexSession = vi.fn().mockResolvedValue({ userAgent: 'jan-test' })
    reloadUserConfig = vi.fn().mockResolvedValue({})
    startReview = vi.fn().mockResolvedValue({ reviewId: 'review-1' })
    refreshMcpServers = vi.fn().mockResolvedValue({})
    steerThread = vi.fn().mockResolvedValue({ turnId: 'steer-turn-1' })
    steerThreadWithEvents = vi.fn(async function* () {
      yield {
        type: 'turn_completed',
        threadId: 'codex-sub-42',
        turnId: 'steer-turn-1',
        turn: { id: 'steer-turn-1', status: 'completed' },
      }
    })

    constructor(params: unknown) {
      mockSessionState.instances.push(this)
      mockSessionState.constructorParams.push(params)
    }
  },
}))

const provider: ModelProvider = {
  active: true,
  provider: 'codex',
  api_key: 'test-key',
  base_url: 'https://api.openai.com/v1',
  settings: [],
  models: [],
}

const model: Model = { id: 'gpt-5.5' }

const messages: UIMessage[] = [
  {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text: 'run the tests' }],
  } as UIMessage,
]

const collect = async (stream: ReadableStream) => {
  const reader = stream.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  return chunks
}

describe('Codex chat backend approval bridge', () => {
  beforeEach(() => {
    clearCodexAppServerChatSessionsForTests()
    mockGlobalRuntime.client = null
    mockGlobalRuntime.processSignature = ''
    mockGlobalRuntime.applyCodexRuntimeOptions.mockClear()
    mockSessionState.instances.length = 0
    mockSessionState.constructorParams.length = 0
    mockSessionState.approvalRequest = {
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'npm test',
        cwd: '/repo',
        reason: 'Run test suite',
      },
    }
    mockThreadsState.threads = {
      'thread-1': { id: 'thread-1', title: 'Thread 1', metadata: {} },
    }
    mockWorkspaceState.directories.clear()
    mockWorkspaceState.calls.length = 0
    mockMcpServersState.mcpServers = {}
    mockSessionState.serverEvents = []
    mockRuntimePermission.requestPermission.mockReset()
    mockRuntimePermission.requestPermission.mockResolvedValue(true)
    mockCodexUserInput.requestUserInput.mockReset()
    mockCodexUserInput.requestUserInput.mockResolvedValue({})
    mockThreadsState.updateThread.mockReset()
    Object.values(mockAppState).forEach((fn) => fn.mockReset())
    mockProfilesState.profiles = {}
    mockProfilesState.activeProfileId = null
    mockModelProviderState.providers = []
    mockProviderRemoteAuthKeyChain.mockReset()
    mockProviderRemoteAuthKeyChain.mockImplementation(async (provider) => {
      const apiKey = provider.api_key?.trim()
      return apiKey ? [apiKey] : []
    })
    mockServiceHubState.mcpCallTool.mockReset()
    mockServiceHubState.startModel.mockReset()
    mockServiceHubState.startModel.mockResolvedValue(undefined)
    mockServiceHubState.getServerStatus.mockReset()
    mockServiceHubState.getServerStatus.mockResolvedValue(true)
    mockServiceHubState.startServer.mockReset()
    mockServiceHubState.startServer.mockResolvedValue(1337)
    ;(window as unknown as { core?: unknown }).core = {
      api: { startServer: mockServiceHubState.startServer },
    }
    mockServiceHubState.mcpCallTool.mockResolvedValue({
      error: '',
      content: [{ text: 'Tool result' }],
    })
  })

  it('routes Codex approval requests through Jan approval modal and accepts approved actions', async () => {
    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messageId: 'assistant-1',
      messages,
      provider,
      model,
    })

    const chunks = await collect(stream)

    expect(mockRuntimePermission.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'codex.command-approval',
        actionLabel: 'Codex command',
        category: 'shell',
        resourceLabel: 'npm test',
        risk: 'high',
        details: expect.objectContaining({
          threadId: 'thread-1',
          requestId: 'approval-1',
          method: 'item/commandExecution/requestApproval',
          command: 'npm test',
          cwd: '/repo',
          reason: 'Run test suite',
        }),
      })
    )
    expect(mockSessionState.instances[0].sendToCodex).toHaveBeenCalledWith(
      'thread-1',
      'run the tests',
      expect.objectContaining({
        clientUserMessageId: 'assistant-1',
        images: [],
      })
    )
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-1',
      { decision: 'approved' }
    )
    expect(chunks).toContainEqual({
      type: 'data-codex-event',
      data: expect.objectContaining({ type: 'approval_request' }),
    })
  })

  it('shows useful details for legacy command approval requests', async () => {
    mockSessionState.approvalRequest = {
      id: 'approval-legacy',
      method: 'execCommandApproval',
      params: {
        command: ['npm', 'test'],
        cwd: '/repo',
        reason: 'Run the test suite',
      },
    }

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messageId: 'assistant-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockRuntimePermission.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'codex.command-approval',
        actionLabel: 'Codex command',
        category: 'shell',
        resourceLabel: 'npm test',
        details: expect.objectContaining({
          threadId: 'thread-1',
          requestId: 'approval-legacy',
          method: 'execCommandApproval',
          command: 'npm test',
          cwd: '/repo',
          reason: 'Run the test suite',
        }),
      })
    )
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-legacy',
      { decision: 'approved' }
    )
  })

  it('auto-resolves item/permissions/requestApproval server requests', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'server_request',
        request: {
          id: 'server-request-1',
          method: 'item/permissions/requestApproval',
          params: {
            permissions: {
              filesystem: true,
            },
          },
        },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'server-request-1',
      { permissions: { filesystem: true } }
    )
    expect(mockRuntimePermission.requestPermission).not.toHaveBeenCalled()
  })

  it('auto-resolves attestation generation server requests', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'server_request',
        request: {
          id: 'server-request-2',
          method: 'attestation/generate',
          params: { challenge: 'abc' },
        },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'server-request-2',
      { token: 'v1.jan-offline' }
    )
  })

  it('auto-resolves tool input requests with empty answers', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'server_request',
        request: {
          id: 'server-request-3',
          method: 'item/tool/requestUserInput',
          params: { question: 'Ask user for info?' },
        },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'server-request-3',
      { answers: {} }
    )
  })

  it('collects Codex tool user input answers when questions are provided', async () => {
    mockCodexUserInput.requestUserInput.mockResolvedValue({
      target_file: 'selected value',
    })
    mockSessionState.serverEvents = [
      {
        type: 'server_request',
        request: {
          id: 'server-request-3b',
          method: 'item/tool/requestUserInput',
          params: {
            questions: [
              {
                id: 'target_file',
                question: 'Which file should Codex inspect?',
              },
            ],
          },
        },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockCodexUserInput.requestUserInput).toHaveBeenCalledWith([
      {
        id: 'target_file',
        label: 'Which file should Codex inspect?',
      },
    ])
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'server-request-3b',
      { answers: { target_file: 'selected value' } }
    )
  })

  it('seeds persisted Codex thread bindings before chat turns', async () => {
    mockThreadsState.threads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Thread 1',
        metadata: { codex: { threadId: 'codex-thread-persisted' } },
      },
    }

    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    expect(mockSessionState.instances[0].seedCodexThreadBinding).toHaveBeenCalledWith(
      'thread-1',
      'codex-thread-persisted'
    )
  })

  it('persists Codex thread ids when thread_started events stream', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'thread_started',
        appThreadId: 'thread-1',
        threadId: 'codex-thread-live',
        thread: { id: 'codex-thread-live' },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-live',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockThreadsState.updateThread).toHaveBeenCalledWith(
      'thread-1',
      expect.objectContaining({
        metadata: expect.objectContaining({
          codex: { threadId: 'codex-thread-live' },
        }),
      })
    )
  })

  it('rejects Codex item/tool/call with disconnect message (Codex engine owns direct MCP execution via declared servers)', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'server_request',
        request: {
          id: 'server-request-4',
          method: 'item/tool/call',
          params: {
            name: 'fs.writeFile',
            serverName: 'filesystem',
            arguments: { path: '/tmp/out' },
          },
        },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    // After disconnecting Jan's proxy: we return a failure explaining that Codex
    // should (and will) use the MCP servers we wrote into its config.toml.
    // Critically, we must NOT call through to Jan's MCP service for Codex engine tool use.

    // NOTE: the new runtime capability layer (skills/plugins/hooks + startMcpOauthLogin + callCodexAppServer etc)
    // is exercised via the ReviewSection capabilities inspector (when codex thread) and the high-level exports.
    // Unit coverage for the thin wrappers + error paths is light here; full paths covered in integration + UI.
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'server-request-4',
      {
        success: false,
        contentItems: [
          {
            type: 'inputText',
            text:
              'Host tool proxy disabled. Codex executes tools directly via MCP servers ' +
              'declared in its per-session config.toml (sourced from Jan MCP settings).',
          },
        ],
      }
    )
    expect(mockServiceHubState.mcpCallTool).not.toHaveBeenCalled()
  })

  it('safely auto-resolves unknown server requests with empty payload', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'server_request',
        request: {
          id: 'server-request-5',
          method: 'item/tool/unsupportedThing',
          params: { foo: 'bar' },
        },
      },
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'server-request-5',
      {}
    )
  })

  it('can answer pending Codex approvals through the public backend API', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    approveCodexAppServerAction('thread-1', 'approval-2', {
      approved: true,
      rememberForSession: true,
    })

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-2',
      { decision: 'approved_for_session' }
    )
  })

  it('can answer pending MCP elicitations through the public backend API', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    approveCodexAppServerAction('thread-1', 'mcp-elicitation-2', {
      approved: false,
      method: 'mcpServer/elicitation/request',
      params: { serverName: 'exa' },
    })

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'mcp-elicitation-2',
      { action: 'decline' }
    )
  })

  it('can answer modern pending approvals with available decisions through the public backend API', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    approveCodexAppServerAction('thread-1', 'approval-modern-1', {
      approved: true,
      rememberForSession: true,
      method: 'item/custom/requestApproval',
      availableDecisions: ['accept', 'acceptForSession', 'decline'],
    })

    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'approval-modern-1',
      { decision: 'acceptForSession' }
    )
  })

  it('builds isolated Codex options from project-bound workspace and provider settings', () => {
    mockThreadsState.threads = {
      'thread-1': {
        id: 'thread-1',
        title: 'Thread 1',
        metadata: {
          project: {
            id: 'project-1',
            name: 'Project One',
          },
        },
      },
    }
    mockWorkspaceState.directories.set(
      'project:project-1',
      '/Users/conrad/project-one'
    )

    const options = buildCodexSessionOptions(
      'thread-1',
      providerWithSettings({
        apiKey: 'settings-key',
        baseUrl: 'http://127.0.0.1:8000/v1',
        codexProvider: 'openrouter',
        codexBinaryPath: '/usr/local/bin/codex',
      }),
      { id: 'gpt-oss:20b' }
    )

    expect(options).toEqual(
      expect.objectContaining({
        codexBinaryPath: '/usr/local/bin/codex',
        codexHome: './.jan/codex-home',
        cwd: '/Users/conrad/project-one',
        model: 'gpt-oss:20b',
        modelProvider: 'jan-gateway',
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
        env: { JAN_LOCAL_API_SERVER_API_KEY: 'jan-local-api-key' },
      })
    )
    expect(options.configToml).toContain('model = "gpt-oss:20b"')
    expect(options.configToml).toContain('model_provider = "jan-gateway"')
    expect(options.configToml).toContain('[model_providers.jan-gateway]')
    expect(options.configToml).not.toContain('[model_providers.openrouter]')
    expect(options.configToml).toContain(
      'base_url = "http://127.0.0.1:1337/v1"'
    )
    expect(options.configToml).toContain(
      'env_key = "JAN_LOCAL_API_SERVER_API_KEY"'
    )
    expect(options.configToml).toContain('wire_api = "responses"')
    expect(mockWorkspaceState.calls).toEqual([
      { type: 'project', id: 'project-1', label: 'Project One' },
    ])
  })

  it('falls back to supported Codex model when selected model is not available', () => {
    const providerWithModels = {
      ...providerWithSettings({ codexProvider: 'openai' }),
      models: [{ id: 'gpt-5.5' }, { id: 'gpt-5.4' }, { id: 'gpt-5.3-codex-spark' }],
    }

    const options = buildCodexSessionOptions(
      'thread-1',
      providerWithModels,
      { id: 'gpt-5.1-codex-max' }
    )

    expect(options.model).toBe('gpt-5.5')
    expect(options.configToml).toContain('model = "gpt-5.5"')
    expect(options.configToml).toContain('model_provider = "jan-gateway"')
  })

  it('falls back to profile-selected supported model when active profile model is stale', () => {
    mockProfilesState.profiles = {
      'profile-1': {
        id: 'profile-1',
        name: 'OpenAI Profile',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.1-codex-max',
        providerType: 'openai',
      },
    }
    mockProfilesState.activeProfileId = 'profile-1'

    const options = buildCodexSessionOptions(
      'thread-1',
      {
        ...provider,
        models: [
          { id: 'gpt-5.5' },
          { id: 'gpt-5.4' },
          { id: 'gpt-5.3-codex-spark' },
        ],
      },
      { id: 'gpt-5.1-codex-max' }
    )

    expect(options.model).toBe('gpt-5.5')
    expect(options.configToml).toContain('model = "gpt-5.5"')
  })

  it('projects a directly selected Ollama provider into Codex config', () => {
    const ollamaProvider: ModelProvider = {
      active: true,
      provider: 'ollama',
      api_key: 'jan',
      base_url: 'http://127.0.0.1:11434/v1',
      settings: [],
      models: [],
    }
    mockModelProviderState.providers = [
      providerWithSettings({ codexBinaryPath: '/custom/codex' }),
    ]

    const options = buildCodexSessionOptions('thread-1', ollamaProvider, {
      id: 'mistral-small3.1:latest',
    })

    expect(options).toEqual(
      expect.objectContaining({
        codexBinaryPath: '/custom/codex',
        model: 'mistral-small3.1:latest',
        modelProvider: 'jan-ollama',
        env: { JAN_CODEX_PROVIDER_API_KEY: 'jan' },
      })
    )
    expect(options.configToml).toContain(
      'model = "mistral-small3.1:latest"'
    )
    expect(options.configToml).toContain('model_provider = "jan-ollama"')
    expect(options.configToml).toContain('[model_providers.jan-ollama]')
    expect(options.configToml).toContain('name = "ollama"')
    expect(options.configToml).toContain(
      'base_url = "http://127.0.0.1:11434/v1"'
    )
    expect(options.configToml).toContain('wire_api = "chat"')
  })

  it('projects xAI Grok models through the xai provider with responses wire API', () => {
    const xaiProvider: ModelProvider = {
      active: true,
      provider: 'xai',
      api_key: 'xai-api-key',
      base_url: 'https://api.x.ai/v1',
      settings: [],
      models: [],
    }

    const options = buildCodexSessionOptions('thread-1', xaiProvider, {
      id: 'grok-4.3',
    })

    expect(options).toEqual(
      expect.objectContaining({
        model: 'grok-4.3',
        modelProvider: 'xai',
        env: { JAN_CODEX_PROVIDER_API_KEY: 'xai-api-key' },
      })
    )
    expect(options.configToml).toContain('model = "grok-4.3"')
    expect(options.configToml).toContain('model_provider = "xai"')
    expect(options.configToml).toContain('[model_providers.xai]')
    expect(options.configToml).toContain('base_url = "https://api.x.ai/v1"')
    expect(options.configToml).toContain('wire_api = "responses"')
    expect(options.configToml).toContain('model_context_window = 1000000')
  })

  it('remaps stale grok-build SSO ids and disables reasoning effort for Codex', () => {
    const xaiProvider: ModelProvider = {
      active: true,
      provider: 'xai',
      api_key: 'xai-api-key',
      base_url: 'https://api.x.ai/v1',
      settings: [],
      models: [],
    }

    const options = buildCodexSessionOptions('thread-1', xaiProvider, {
      id: 'grok-build-0.1',
    })

    expect(options.model).toBe('grok-4.3')
    expect(options.configToml).toContain('model = "grok-4.3"')
    expect(options.configToml).toContain('model_reasoning_effort = "none"')
  })

  it('reroutes grok models away from jan-openai when Codex settings still target openai', () => {
    const codexProvider = providerWithSettings({
      codexProvider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    })

    const options = buildCodexSessionOptions('thread-1', codexProvider, {
      id: 'grok-4.3',
    })

    expect(options).toEqual(
      expect.objectContaining({
        model: 'grok-4.3',
        modelProvider: 'jan-gateway',
      })
    )
    expect(options.configToml).toContain('model_provider = "jan-gateway"')
    expect(options.configToml).not.toContain('model_provider = "jan-openai"')
    expect(options.configToml).toContain('base_url = "http://127.0.0.1:1337/v1"')
    expect(options.configToml).toContain('wire_api = "responses"')
  })

  it('uses the Jan local API server as the default llama.cpp Codex endpoint', () => {
    const llamacppProvider: ModelProvider = {
      active: true,
      provider: 'llamacpp',
      api_key: 'jan',
      base_url: '',
      settings: [],
      models: [],
    }

    const options = buildCodexSessionOptions('thread-1', llamacppProvider, {
      id: 'Jan-v1-4B-Q4_K_M',
    })

    expect(options).toEqual(
      expect.objectContaining({
        model: 'Jan-v1-4B-Q4_K_M',
        modelProvider: 'llamacpp',
      })
    )
    expect(options.configToml).toContain('[model_providers.llamacpp]')
    expect(options.configToml).toContain(
      'base_url = "http://127.0.0.1:1337/v1"'
    )
    expect(options.configToml).toContain('wire_api = "chat"')
  })

  it('starts Jan-hosted local models and the local API server before Codex chat', async () => {
    mockServiceHubState.getServerStatus.mockResolvedValue(false)
    const llamacppProvider: ModelProvider = {
      active: true,
      provider: 'llamacpp',
      api_key: 'jan',
      base_url: '',
      settings: [],
      models: [{ id: 'Jan-v1-4B-Q4_K_M' }],
    }

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: llamacppProvider,
      model: { id: 'Jan-v1-4B-Q4_K_M' },
    })
    await collect(stream)

    expect(mockServiceHubState.startModel).toHaveBeenCalledWith(
      llamacppProvider,
      'Jan-v1-4B-Q4_K_M',
      true
    )
    expect(mockServiceHubState.startServer).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 1337,
      prefix: '/v1',
      apiKey: 'jan-local-api-key',
      trustedHosts: ['localhost'],
      isCorsEnabled: true,
      isVerboseEnabled: true,
      proxyTimeout: 600,
    })
    expect(mockSessionState.instances).toHaveLength(1)
  })

  it('uses chat-bound workspace directories and falls back to current directory', () => {
    mockWorkspaceState.directories.set(
      'chat:thread-1',
      '/Users/conrad/chat-space/'
    )

    expect(buildCodexSessionOptions('thread-1', provider, model)).toEqual(
      expect.objectContaining({
        cwd: '/Users/conrad/chat-space/',
        codexHome: './.jan/codex-home',
      })
    )

    mockWorkspaceState.directories.clear()

    expect(buildCodexSessionOptions('thread-1', provider, model)).toEqual(
      expect.objectContaining({
        cwd: './',
        codexHome: './.jan/codex-home',
      })
    )
  })

  it('selects proto transport from provider settings', () => {
    const options = buildCodexSessionOptions(
      'thread-1',
      providerWithSettings({ codexTransport: 'proto' }),
      model
    )

    expect(options).toEqual(
      expect.objectContaining({
        transport: 'proto',
      })
    )
  })

  it('writes active Jan MCP servers into Codex config.toml for the runtime', () => {
    mockMcpServersState.mcpServers = {
      exa: {
        command: '',
        args: [],
        env: {},
        type: 'http',
        url: 'https://mcp.exa.ai/mcp',
        active: true,
      },
      fetch: {
        command: 'uvx',
        args: ['mcp-server-fetch'],
        env: {},
        active: true,
      },
      disabled: {
        command: 'npx',
        args: ['-y', 'disabled-mcp'],
        env: {},
        active: false,
      },
    }

    const options = buildCodexSessionOptions('thread-1', provider, model)

    expect(options.configToml).toContain('[mcp_servers.exa]')
    expect(options.configToml).toContain('url = "https://mcp.exa.ai/mcp"')
    expect(options.configToml).toContain('[mcp_servers.fetch]')
    expect(options.configToml).toContain('command = "uvx"')
    expect(options.configToml).not.toContain('disabled')
    expect(options.configToml).toContain('tool_timeout_sec = 30')
  })

  it('routes MCP elicitation requests through the approval modal', async () => {
    mockSessionState.approvalRequest = {
      id: 'mcp-elicitation-1',
      method: 'mcpServer/elicitation/request',
      params: {
        serverName: 'exa',
        message: 'Approve web search?',
        mode: 'form',
      },
    }

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockRuntimePermission.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: 'codex.mcp-elicitation',
        actionLabel: 'MCP: exa',
        category: 'app',
        resourceLabel: 'exa',
        risk: 'medium',
        details: expect.objectContaining({
          threadId: 'thread-1',
          requestId: 'mcp-elicitation-1',
          method: 'mcpServer/elicitation/request',
          message: 'Approve web search?',
          mode: 'form',
          serverName: 'exa',
        }),
      })
    )
    expect(mockSessionState.instances[0].approveAction).toHaveBeenCalledWith(
      'mcp-elicitation-1',
      { action: 'accept' }
    )
  })

  it('reuses the global Codex process and syncs runtime config when provider settings change', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    expect(mockSessionState.instances).toHaveLength(1)

    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: providerWithSettings({
        apiKey: 'test-key',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
      model,
    })

    expect(mockSessionState.instances).toHaveLength(1)
    expect(mockSessionState.instances[0].shutdownCodex).not.toHaveBeenCalled()
    expect(mockGlobalRuntime.applyCodexRuntimeOptions).toHaveBeenCalled()
    expect(mockSessionState.instances[0].setThreadOptions).toHaveBeenCalled()
  })

  it('syncs runtime config when active MCP servers change without restarting Codex', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    mockMcpServersState.mcpServers = {
      exa: {
        command: '',
        args: [],
        env: {},
        type: 'http',
        url: 'https://mcp.exa.ai/mcp',
        active: true,
      },
    }

    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    expect(mockSessionState.instances).toHaveLength(1)
    expect(mockSessionState.instances[0].shutdownCodex).not.toHaveBeenCalled()
    expect(mockGlobalRuntime.applyCodexRuntimeOptions).toHaveBeenCalledTimes(2)
  })

  it('keeps the global Codex process warm when stale Codex API key settings change', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: providerWithSettings({
        apiKey: 'first-key',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
      model,
    })
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider: providerWithSettings({
        apiKey: 'second-key',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
      model,
    })

    expect(mockSessionState.instances).toHaveLength(1)
    expect(mockSessionState.instances[0].shutdownCodex).not.toHaveBeenCalled()
    expect(mockGlobalRuntime.applyCodexRuntimeOptions).toHaveBeenCalledTimes(2)
  })

  it('removes abort listeners after the Codex stream finishes', async () => {
    const abortController = new AbortController()
    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
      abortSignal: abortController.signal,
    })

    await collect(stream)
    abortController.abort()

    expect(mockSessionState.instances[0].interruptTurn).not.toHaveBeenCalled()
  })

  it('builds Codex options using the active runtime provider profile if set', () => {
    mockProfilesState.profiles = {
      'profile-1': {
        id: 'profile-1',
        name: 'Ollama Profile',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3-coder',
        apiKeyEnv: 'OLLAMA_API_KEY',
        codexHome: '/Users/conrad/ollama-home',
        transport: 'proto',
        providerType: 'ollama',
      },
    }
    mockProfilesState.activeProfileId = 'profile-1'

    mockModelProviderState.providers = [
      {
        provider: 'ollama',
        api_key: 'ollama-test-key',
        settings: [],
      },
    ]

    const options = buildCodexSessionOptions('thread-1', provider, model)

    expect(options).toEqual(
      expect.objectContaining({
        codexHome: '/Users/conrad/ollama-home',
        transport: 'proto',
        model: 'qwen3-coder',
        modelProvider: 'jan-ollama',
        env: { OLLAMA_API_KEY: 'ollama-test-key' },
      })
    )
    expect(options.configToml).toContain('model = "qwen3-coder"')
    expect(options.configToml).toContain('model_provider = "jan-ollama"')
    expect(options.configToml).toContain('[model_providers.jan-ollama]')
    expect(options.configToml).not.toContain('[model_providers.ollama]')
    expect(options.configToml).toContain(
      'base_url = "http://localhost:11434/v1"'
    )
    expect(options.configToml).toContain('env_key = "OLLAMA_API_KEY"')
  })

  it('labels subagent approvals with codexThreadId in permission details', async () => {
    mockSessionState.approvalRequest = {
      id: 'approval-sub',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'rg TODO',
        cwd: '/repo',
        reason: 'Search codebase',
        threadId: 'codex-sub-thread-9',
      },
    }

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockRuntimePermission.requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          janThreadId: 'thread-1',
          threadId: 'thread-1',
          codexThreadId: 'codex-sub-thread-9',
          source: 'subagent',
        }),
      })
    )
  })

  it('forwards image attachments to Codex turn input', async () => {
    mockSessionState.serverEvents = [
      {
        type: 'turn_completed',
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        turn: { id: 'turn-1', status: 'completed' },
      },
    ]

    const imageMessages: UIMessage[] = [
      {
        id: 'user-img',
        role: 'user',
        parts: [
          { type: 'text', text: 'what is in this screenshot?' },
          {
            type: 'file',
            mediaType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUg',
          },
        ],
      } as UIMessage,
    ]

    const stream = await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages: imageMessages,
      provider,
      model,
    })

    await collect(stream)

    expect(mockSessionState.instances[0].sendToCodex).toHaveBeenCalledWith(
      'thread-1',
      'what is in this screenshot?',
      expect.objectContaining({
        images: [{ data: 'iVBORw0KGgoAAAANSUhEUg', mediaType: 'image/png' }],
      })
    )
  })

  it('starts detached Codex review via high-level API', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await startCodexReview('thread-1', { type: 'uncommittedChanges' })

    expect(mockSessionState.instances[0].startReview).toHaveBeenCalledWith(
      'thread-1',
      { type: 'uncommittedChanges' },
      expect.objectContaining({ delivery: 'detached' })
    )
  })

  it('streams steer events for subagent inspector until turn completes', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    const events = []
    for await (const event of steerCodexSubThreadEvents(
      'thread-1',
      'codex-sub-42',
      'continue analysis'
    )) {
      events.push(event)
    }

    expect(mockSessionState.instances[0].steerThreadWithEvents).toHaveBeenCalledWith(
      'codex-sub-42',
      'continue analysis',
      undefined,
      undefined
    )
    expect(events).toEqual([
      expect.objectContaining({
        type: 'turn_completed',
        threadId: 'codex-sub-42',
      }),
    ])
  })

  it('steers a subagent thread with optional image attachments', async () => {
    await sendCodexAppServerChatMessage({
      threadId: 'thread-1',
      messages,
      provider,
      model,
    })

    await steerCodexSubThread('thread-1', 'codex-sub-42', 'check this UI', {
      clientUserMessageId: 'steer-msg-1',
      images: [{ data: 'base64img', mediaType: 'image/png' }],
    })

    expect(mockSessionState.instances[0].steerThread).toHaveBeenCalledWith(
      'codex-sub-42',
      'check this UI',
      'steer-msg-1',
      [{ data: 'base64img', mediaType: 'image/png' }]
    )
  })

  it('runs codex logout via Tauri CLI bridge', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: 'Credentials removed',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexLogout({ codexHome: '/tmp/codex-home' })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['logout'],
      cwd: null,
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex mcp via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliMcp({
      codexHome: '/tmp/codex-home',
      args: ['-c', 'foo=bar'],
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['mcp', '-c', 'foo=bar'],
      cwd: null,
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex proto via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliProto({
      args: ['--help'],
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['proto', '--help'],
      cwd: null,
      codexHome: null,
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex debug via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliDebug({
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
      args: ['help'],
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['debug', 'help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex cloud via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliCloud({
      args: ['status'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['cloud', 'status'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex remote-control via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliRemoteControl({
      args: ['status'],
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['remote-control', 'status'],
      cwd: '/repo',
      codexHome: null,
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex arbitrary command via raw command helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliCommand({
      command: 'codex',
      args: ['doctor', '--help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['doctor', '--help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex help via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliHelp({
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex app-server via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliAppServer({
      args: ['--stdio'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['app-server', '--stdio'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex doctor via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliDoctor({
      args: ['--help'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['doctor', '--help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex features via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliFeatures({
      args: ['--help'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['features', '--help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex plugin via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliPlugin({
      args: ['list'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['plugin', 'list'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex review via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliReview({
      args: ['--help'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
      prompt: 'Check changes',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['review', '--help', 'Check changes'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex archive via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliArchive({
      args: ['thread-1'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['archive', 'thread-1'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex unarchive via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliUnarchive({
      args: ['thread-1'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['unarchive', 'thread-1'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex fork via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliFork({
      args: ['thread-1'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['fork', 'thread-1'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex resume via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliResume({
      args: ['thread-1'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['resume', 'thread-1'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex sandbox via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliSandbox({
      args: ['--help'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['sandbox', '--help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex update via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliUpdate({
      args: ['--help'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['update', '--help'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex exec-server via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliExecServer({
      args: ['status'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['exec-server', 'status'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex mcp-server via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliMcpServer({
      args: ['--stdio'],
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['mcp-server', '--stdio'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex app via dedicated helper', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexCliApp({
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['app'],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.exitCode).toBe(0)
  })

  it('runs codex exec non-interactively with workspace flags', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: '{"type":"turn_completed"}',
      stderr: '',
      exitCode: 0,
    })

    await runCodexExec({
      prompt: 'fix the failing test',
      codexHome: '/tmp/codex-home',
      cwd: '/repo',
      addDirs: ['/extra'],
      sandbox: 'workspace-write',
      jsonOutput: true,
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: [
        'exec',
        '--sandbox',
        'workspace-write',
        '--json',
        '-C',
        '/repo',
        '--add-dir',
        '/extra',
        'fix the failing test',
      ],
      cwd: '/repo',
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
  })

  it('reads codex version via Tauri CLI bridge', async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      stdout: 'codex 0.1.0',
      stderr: '',
      exitCode: 0,
    })

    const result = await runCodexVersion({
      codexHome: '/tmp/codex-home',
    })

    expect(invoke).toHaveBeenCalledWith('run_codex_cli_subcommand', {
      command: 'codex',
      args: ['-V'],
      cwd: null,
      codexHome: '/tmp/codex-home',
      extraEnv: null,
    })
    expect(result.stdout).toBe('codex 0.1.0')
  })

  it('emits profile agentsMd, customAgents, addDirs, and advanced config to session options', () => {
    mockProfilesState.profiles = {
      'profile-1': {
        id: 'profile-1',
        name: 'Full Profile',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3-coder',
        codexHome: '/tmp/codex-home',
        providerType: 'ollama',
        agentsMd: '# Project agents\nUse TDD.',
        subagentMaxThreads: 4,
        subagentMaxDepth: 2,
        permissionProfile: 'developer',
        addDirs: ['/extra/root'],
        customAgents: [
          {
            name: 'reviewer',
            description: 'Code reviewer',
            developer_instructions: 'Find bugs.',
          },
        ],
        advancedConfigSnippet: '[hooks]\npre_turn = ["echo hook"]',
      },
    }
    mockProfilesState.activeProfileId = 'profile-1'

    const options = buildCodexSessionOptions('thread-1', provider, model)

    expect(options).toEqual(
      expect.objectContaining({
        agentsMd: '# Project agents\nUse TDD.',
        subagentMaxThreads: 4,
        subagentMaxDepth: 2,
        permissionProfile: 'developer',
        addDirs: ['/extra/root'],
        customAgents: [
          expect.objectContaining({ name: 'reviewer' }),
        ],
        advancedConfigSnippet: '[hooks]\npre_turn = ["echo hook"]',
      })
    )
    expect(options.configToml).toContain('[agents]')
    expect(options.configToml).toContain('max_threads = 4')
    expect(options.configToml).toContain('default_permissions = "developer"')
    expect(options.configToml).toContain('[hooks]')
  })

  it('builds Codex options with custom approvalPolicy and sandbox from active profile if set', () => {
    mockProfilesState.profiles = {
      'profile-1': {
        id: 'profile-1',
        name: 'Secure Ollama Profile',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen3-coder',
        apiKeyEnv: 'OLLAMA_API_KEY',
        codexHome: '/Users/conrad/ollama-home',
        providerType: 'ollama',
        transport: 'proto',
        approvalPolicy: 'untrusted',
        sandbox: 'read-only',
      },
    }
    mockProfilesState.activeProfileId = 'profile-1'

    const options = buildCodexSessionOptions('thread-1', provider, model)

    expect(options).toEqual(
      expect.objectContaining({
        transport: 'proto',
        approvalPolicy: 'untrusted',
        sandbox: 'read-only',
      })
    )
  })
})

function providerWithSettings({
  apiKey = '',
  baseUrl = '',
  codexProvider = '',
  codexBinaryPath = '',
  codexTransport = '',
}: {
  apiKey?: string
  baseUrl?: string
  codexProvider?: string
  codexBinaryPath?: string
  codexTransport?: string
}): ModelProvider {
  return {
    active: true,
    provider: 'codex',
    api_key: '',
    base_url: '',
    settings: [
      setting('api-key', apiKey),
      setting('base-url', baseUrl),
      setting('codex-provider', codexProvider),
      setting('codex-binary-path', codexBinaryPath),
      setting('codex-transport', codexTransport),
    ],
    models: [],
  }
}

function setting(key: string, value: string) {
  return {
    key,
    controller_props: { value },
  } as ModelProvider['settings'][number]
}
