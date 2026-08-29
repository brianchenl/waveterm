// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from "@/app/i18n/use-i18n";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { base64ToString, stringToBase64 } from "@/util/util";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
    buildAIMode,
    getAIProviderDefaults,
    kimiModelSupportsReasoningEffort,
    makeAIModeKey,
    mergeAIModeConfig,
    type ReasoningEffort,
    type WindowsAIProvider,
} from "./windowssetup-ai";

const AgentRepairCommand =
    "Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent; Get-Service ssh-agent";

function StatusPill({ ok, okText, errorText }: { ok: boolean; okText: string; errorText: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                ok ? "border-success/40 bg-success/10 text-success" : "border-error/40 bg-error/10 text-error"
            }`}
        >
            <i className={`fa-sharp fa-solid ${ok ? "fa-circle-check" : "fa-circle-xmark"}`} aria-hidden="true" />
            {ok ? okText : errorText}
        </span>
    );
}

function SetupSection({
    icon,
    title,
    description,
    children,
}: {
    icon: string;
    title: string;
    description: string;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-xl border border-border bg-panel/80 shadow-sm">
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <i className={`fa-sharp fa-solid ${icon}`} aria-hidden="true" />
                </div>
                <div>
                    <h2 className="text-base font-semibold text-primary">{title}</h2>
                    <p className="mt-0.5 text-sm text-secondary">{description}</p>
                </div>
            </div>
            <div className="p-5">{children}</div>
        </section>
    );
}

function SSHDiagnostics({ model }: { model: WaveConfigViewModel }) {
    const { t } = useTranslation();
    const [diagnostics, setDiagnostics] = useState<CommandWindowsDiagnosticsRtnData | null>(null);
    const [selectedHost, setSelectedHost] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [copyStatus, setCopyStatus] = useState("");
    const hostSelectId = useId();

    const refresh = useCallback(
        async (host = selectedHost) => {
            setLoading(true);
            setError("");
            try {
                const result = await model.env.rpc.WindowsDiagnosticsCommand(
                    TabRpcClient,
                    { sshhost: host },
                    { timeout: 12_000 }
                );
                setDiagnostics(result);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setLoading(false);
            }
        },
        [model, selectedHost]
    );

    useEffect(() => {
        refresh("");
    }, [refresh]);

    const chooseHost = async (host: string) => {
        setSelectedHost(host);
        await refresh(host);
    };

    const copyAgentCommand = async () => {
        try {
            await navigator.clipboard.writeText(AgentRepairCommand);
            setCopyStatus(t("Command copied"));
        } catch {
            setCopyStatus(t("Copy failed"));
        }
    };

    return (
        <SetupSection
            icon="fa-shield-keyhole"
            title={t("SSH diagnostics")}
            description={t("Verify the Windows SSH config, resolved host values, and OpenSSH Agent.")}
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                    <StatusPill
                        ok={diagnostics?.sshconfigreadable === true}
                        okText={t("SSH config readable")}
                        errorText={t("SSH config unavailable")}
                    />
                    <StatusPill
                        ok={diagnostics?.sshagentavailable === true}
                        okText={t("SSH Agent running")}
                        errorText={t("SSH Agent unavailable")}
                    />
                </div>
                <button
                    type="button"
                    onClick={() => refresh()}
                    disabled={loading}
                    className="min-h-10 cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-wait disabled:opacity-60"
                >
                    <i
                        className={`fa-sharp fa-solid fa-rotate mr-2 ${loading ? "animate-spin" : ""}`}
                        aria-hidden="true"
                    />
                    {t("Refresh diagnostics")}
                </button>
            </div>

            {error && (
                <div
                    className="mt-4 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error"
                    role="alert"
                >
                    {t("Diagnostics failed: {{error}}", { error })}
                </div>
            )}

            {diagnostics && (
                <div className="mt-5 grid gap-4 @w700:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background/60 p-4">
                        <h3 className="text-sm font-semibold text-primary">{t("SSH configuration")}</h3>
                        <dl className="mt-3 space-y-2 text-sm">
                            <div>
                                <dt className="text-xs text-muted-foreground">{t("Configuration path")}</dt>
                                <dd className="mt-1 break-all font-mono text-xs text-secondary">
                                    {diagnostics.sshconfigpath}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <dt className="text-muted-foreground">{t("Detected hosts")}</dt>
                                <dd className="font-mono text-primary">{diagnostics.sshhosts?.length ?? 0}</dd>
                            </div>
                        </dl>
                        {diagnostics.sshconfighasmatch && (
                            <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                                {t("Match directives are detected but are not applied by Wave.")}
                            </p>
                        )}
                        {(diagnostics.sshhosts?.length ?? 0) > 0 && (
                            <div className="mt-4">
                                <label
                                    htmlFor={hostSelectId}
                                    className="mb-1.5 block text-xs font-medium text-secondary"
                                >
                                    {t("Inspect a host")}
                                </label>
                                <select
                                    id={hostSelectId}
                                    value={selectedHost}
                                    onChange={(event) => chooseHost(event.target.value)}
                                    className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    <option value="">{t("Select an SSH host")}</option>
                                    {diagnostics.sshhosts?.map((host) => (
                                        <option key={host} value={host}>
                                            {host}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {diagnostics.selectedsshhost && (
                            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 rounded-md border border-border bg-panel/60 p-3 text-xs">
                                <dt className="text-muted-foreground">{t("Host name")}</dt>
                                <dd className="break-all font-mono text-primary">
                                    {diagnostics.selectedsshhost.hostname}
                                </dd>
                                <dt className="text-muted-foreground">{t("User")}</dt>
                                <dd className="break-all font-mono text-primary">{diagnostics.selectedsshhost.user}</dd>
                                <dt className="text-muted-foreground">{t("Port")}</dt>
                                <dd className="font-mono text-primary">{diagnostics.selectedsshhost.port}</dd>
                                <dt className="text-muted-foreground">{t("Identity files")}</dt>
                                <dd className="break-all font-mono text-primary">
                                    {diagnostics.selectedsshhost.identityfiles?.join(", ") || t("Default keys")}
                                </dd>
                                <dt className="text-muted-foreground">{t("Proxy jump")}</dt>
                                <dd className="break-all font-mono text-primary">
                                    {diagnostics.selectedsshhost.proxyjump?.join(" → ") || t("None")}
                                </dd>
                            </dl>
                        )}
                    </div>

                    <div className="rounded-lg border border-border bg-background/60 p-4">
                        <h3 className="text-sm font-semibold text-primary">{t("OpenSSH Agent")}</h3>
                        <dl className="mt-3 space-y-2 text-sm">
                            <div>
                                <dt className="text-xs text-muted-foreground">{t("Agent pipe")}</dt>
                                <dd className="mt-1 break-all font-mono text-xs text-secondary">
                                    {diagnostics.sshagentpath}
                                </dd>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <dt className="text-muted-foreground">{t("Loaded keys")}</dt>
                                <dd className="font-mono text-primary">{diagnostics.sshagentkeycount}</dd>
                            </div>
                        </dl>
                        {!diagnostics.sshagentavailable && (
                            <div className="mt-4 rounded-md border border-warning/40 bg-warning/10 p-3">
                                <p className="text-xs text-warning">
                                    {t("Run this command in an administrator PowerShell window to enable the agent:")}
                                </p>
                                <code className="mt-2 block select-all break-all rounded bg-black/30 p-2 text-xs text-secondary">
                                    {AgentRepairCommand}
                                </code>
                                <button
                                    type="button"
                                    onClick={copyAgentCommand}
                                    className="mt-3 min-h-10 cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                >
                                    <i className="fa-sharp fa-solid fa-copy mr-2" aria-hidden="true" />
                                    {t("Copy repair command")}
                                </button>
                                <span className="ml-3 text-xs text-muted-foreground" aria-live="polite">
                                    {copyStatus}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </SetupSection>
    );
}

function ShellManager({ model }: { model: WaveConfigViewModel }) {
    const { t } = useTranslation();
    const [diagnostics, setDiagnostics] = useState<CommandWindowsDiagnosticsRtnData | null>(null);
    const [savingId, setSavingId] = useState("");
    const [status, setStatus] = useState("");

    const refresh = useCallback(async () => {
        const result = await model.env.rpc.WindowsDiagnosticsCommand(TabRpcClient, {}, { timeout: 12_000 });
        setDiagnostics(result);
    }, [model]);

    useEffect(() => {
        refresh().catch((error) => setStatus(t("Unable to detect shells: {{error}}", { error: String(error) })));
    }, [refresh, t]);

    const selectShell = async (shell: WindowsShellInfo) => {
        setSavingId(shell.id);
        setStatus("");
        try {
            const isPowerShell = shell.id === "pwsh" || shell.id === "powershell";
            await model.env.rpc.SetConfigCommand(TabRpcClient, {
                "term:localshellpath": shell.path,
                "term:localshellopts": isPowerShell ? ["-NoLogo"] : [],
            });
            setStatus(t("Default shell changed to {{shell}}", { shell: shell.name }));
            await refresh();
        } catch (error) {
            setStatus(t("Unable to save shell: {{error}}", { error: String(error) }));
        } finally {
            setSavingId("");
        }
    };

    return (
        <SetupSection
            icon="fa-terminal"
            title={t("Shell manager")}
            description={t("Detect installed Windows shells and choose the default for new local terminals.")}
        >
            <div className="grid gap-3 @w700:grid-cols-2">
                {diagnostics?.shells?.map((shell) => {
                    const isCurrent = diagnostics.currentlocalshellpath === shell.path;
                    return (
                        <div
                            key={shell.id}
                            className={`rounded-lg border p-4 ${
                                isCurrent ? "border-accent bg-accent/10" : "border-border bg-background/60"
                            }`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="text-sm font-semibold text-primary">{t(shell.name)}</h3>
                                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                                        {shell.path || t("Not detected")}
                                    </p>
                                </div>
                                {shell.recommended && (
                                    <span className="rounded-full bg-accent/15 px-2 py-1 text-[11px] text-accent">
                                        {t("Recommended")}
                                    </span>
                                )}
                            </div>
                            <button
                                type="button"
                                onClick={() => selectShell(shell)}
                                disabled={!shell.available || isCurrent || savingId !== ""}
                                className="mt-4 min-h-10 w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm text-primary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {savingId === shell.id
                                    ? t("Saving...")
                                    : isCurrent
                                      ? t("Current default")
                                      : t("Set as default")}
                            </button>
                        </div>
                    );
                })}
            </div>
            <p className="mt-3 min-h-5 text-xs text-muted-foreground" aria-live="polite">
                {status}
            </p>
        </SetupSection>
    );
}

function AISetupWizard({ model }: { model: WaveConfigViewModel }) {
    const { t } = useTranslation();
    const [step, setStep] = useState(1);
    const [provider, setProvider] = useState<WindowsAIProvider>("ollama");
    const [modelName, setModelName] = useState(() => getAIProviderDefaults("ollama").model);
    const [apiToken, setApiToken] = useState("");
    const [proxyUrl, setProxyUrl] = useState("");
    const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("high");
    const [testResult, setTestResult] = useState<CommandAIProviderTestRtnData | null>(null);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState("");
    const modelInputId = useId();
    const apiTokenId = useId();
    const effortId = useId();

    const providerOptions: Array<{ id: WindowsAIProvider; icon: string; description: string }> = useMemo(
        () => [
            {
                id: "ollama",
                icon: "fa-microchip",
                description: t("Local and private; automatically detects installed models."),
            },
            {
                id: "deepseek",
                icon: "fa-brain",
                description: t("DeepSeek cloud API with thinking and reasoning effort."),
            },
            {
                id: "kimi",
                icon: "fa-moon",
                description: t("Kimi Code Plan membership API for coding models and tools."),
            },
        ],
        [t]
    );

    const chooseProvider = (nextProvider: WindowsAIProvider) => {
        setProvider(nextProvider);
        setModelName(getAIProviderDefaults(nextProvider).model);
        setApiToken("");
        setProxyUrl("");
        setTestResult(null);
        setStatus("");
    };

    const testConnection = async () => {
        setTesting(true);
        setStatus("");
        setTestResult(null);
        try {
            const result = await model.env.rpc.AIProviderTestCommand(
                TabRpcClient,
                { provider, apitoken: apiToken, proxyurl: proxyUrl },
                { timeout: 15_000 }
            );
            setTestResult(result);
            if (result.success && provider === "ollama" && result.models?.length > 0) {
                setModelName(result.models[0]);
            }
        } catch (error) {
            setTestResult({ success: false, latencyms: 0, error: String(error) });
        } finally {
            setTesting(false);
        }
    };

    const saveConfiguration = async () => {
        if (!modelName.trim()) return;
        setSaving(true);
        setStatus("");
        try {
            const modeKey = makeAIModeKey(provider, modelName);
            const aiMode = buildAIMode(provider, modelName, reasoningEffort, proxyUrl.trim());
            const configPath = `${model.configDir}/waveai.json`;
            const currentFile = await model.env.rpc.FileReadCommand(TabRpcClient, { info: { path: configPath } });
            const currentConfig = currentFile?.data64
                ? (JSON.parse(base64ToString(currentFile.data64)) as Record<string, AIModeConfigType>)
                : {};
            const mergedConfig = mergeAIModeConfig(currentConfig, modeKey, aiMode);

            const secretName = getAIProviderDefaults(provider).secretName;
            if (secretName && apiToken) {
                await model.env.rpc.SetSecretsCommand(TabRpcClient, { [secretName]: apiToken });
            }
            await model.env.rpc.FileWriteCommand(TabRpcClient, {
                info: { path: configPath },
                data64: stringToBase64(JSON.stringify(mergedConfig, null, 2)),
            });
            await model.env.rpc.SetConfigCommand(TabRpcClient, {
                "waveai:defaultmode": modeKey,
                "waveai:showcloudmodes": false,
            });
            setApiToken("");
            setStatus(t("AI setup complete. {{mode}} is now the default mode.", { mode: modeKey }));
        } catch (error) {
            setStatus(t("Unable to save AI setup: {{error}}", { error: String(error) }));
        } finally {
            setSaving(false);
        }
    };

    const providerName = getAIProviderDefaults(provider).displayName;

    return (
        <SetupSection
            icon="fa-wand-magic-sparkles"
            title={t("AI initialization wizard")}
            description={t("Configure Ollama, DeepSeek, or Kimi Code Plan in three validated steps.")}
        >
            <ol className="mb-5 grid grid-cols-3 gap-2" aria-label={t("AI setup progress")}>
                {[1, 2, 3].map((item) => (
                    <li
                        key={item}
                        className={`rounded-md border px-3 py-2 text-center text-xs ${
                            item === step
                                ? "border-accent bg-accent/15 text-primary"
                                : item < step
                                  ? "border-success/40 bg-success/10 text-success"
                                  : "border-border text-muted-foreground"
                        }`}
                    >
                        {t("Step {{step}}", { step: item })}
                    </li>
                ))}
            </ol>

            {step === 1 && (
                <div>
                    <h3 className="text-sm font-semibold text-primary">{t("Choose an AI provider")}</h3>
                    <div className="mt-3 grid gap-3 @w700:grid-cols-3">
                        {providerOptions.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => chooseProvider(option.id)}
                                className={`min-h-32 cursor-pointer rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                                    provider === option.id
                                        ? "border-accent bg-accent/15"
                                        : "border-border bg-background/60 hover:bg-hover"
                                }`}
                            >
                                <i
                                    className={`fa-sharp fa-solid ${option.icon} text-lg text-accent`}
                                    aria-hidden="true"
                                />
                                <span className="mt-3 block text-sm font-semibold text-primary">
                                    {getAIProviderDefaults(option.id).displayName}
                                </span>
                                <span className="mt-1 block text-xs leading-5 text-secondary">
                                    {option.description}
                                </span>
                            </button>
                        ))}
                    </div>
                    <div className="mt-5 flex justify-end">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="min-h-10 cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {t("Next")}
                        </button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="max-w-xl">
                    <h3 className="text-sm font-semibold text-primary">
                        {t("Test {{provider}} connection", { provider: providerName })}
                    </h3>
                    {provider !== "ollama" && (
                        <>
                            <div className="mt-4">
                                <label htmlFor={apiTokenId} className="mb-1.5 block text-xs font-medium text-secondary">
                                    {t("API key")}
                                </label>
                                <input
                                    id={apiTokenId}
                                    type="password"
                                    autoComplete="off"
                                    value={apiToken}
                                    onChange={(event) => {
                                        setApiToken(event.target.value);
                                        setTestResult(null);
                                    }}
                                    className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                />
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    {t(
                                        "The key is stored in Windows Credential Manager and is never written to waveai.json."
                                    )}
                                </p>
                            </div>
                            <div className="mt-4">
                                <label
                                    htmlFor={`${apiTokenId}-proxy`}
                                    className="mb-1.5 block text-xs font-medium text-secondary"
                                >
                                    {t("Proxy URL (optional)")}
                                </label>
                                <input
                                    id={`${apiTokenId}-proxy`}
                                    type="url"
                                    value={proxyUrl}
                                    placeholder="http://127.0.0.1:7890"
                                    onChange={(event) => {
                                        setProxyUrl(event.target.value);
                                        setTestResult(null);
                                    }}
                                    className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                                />
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                    {t("Supports HTTP, HTTPS, and SOCKS5 proxy URLs.")}
                                </p>
                            </div>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={testConnection}
                        disabled={testing || (provider !== "ollama" && !apiToken)}
                        className="mt-4 min-h-10 cursor-pointer rounded-md border border-accent bg-accent/15 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <i
                            className={`fa-sharp fa-solid fa-plug mr-2 ${testing ? "animate-pulse" : ""}`}
                            aria-hidden="true"
                        />
                        {testing ? t("Testing...") : t("Test connection")}
                    </button>
                    {testResult && (
                        <div
                            className={`mt-4 rounded-md border px-3 py-2 text-sm ${
                                testResult.success
                                    ? "border-success/40 bg-success/10 text-success"
                                    : "border-error/40 bg-error/10 text-error"
                            }`}
                            role="status"
                        >
                            {testResult.success
                                ? t("Connection successful ({{latency}} ms, {{count}} models)", {
                                      latency: testResult.latencyms,
                                      count: testResult.models?.length ?? 0,
                                  })
                                : testResult.error === "api-token-required"
                                  ? t("An API key is required")
                                  : testResult.error === "invalid-proxy-url"
                                    ? t("The proxy URL is invalid")
                                    : t("Connection failed: {{error}}", {
                                          error: testResult.error ?? t("Unknown error"),
                                      })}
                        </div>
                    )}
                    <div className="mt-5 flex justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => setStep(1)}
                            className="min-h-10 cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm text-primary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {t("Prev")}
                        </button>
                        <button
                            type="button"
                            onClick={() => setStep(3)}
                            disabled={!testResult?.success}
                            className="min-h-10 cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {t("Next")}
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="max-w-xl">
                    <h3 className="text-sm font-semibold text-primary">{t("Choose model parameters")}</h3>
                    <div className="mt-4">
                        <label htmlFor={modelInputId} className="mb-1.5 block text-xs font-medium text-secondary">
                            {t("Model")}
                        </label>
                        {testResult?.models?.length ? (
                            <select
                                id={modelInputId}
                                value={modelName}
                                onChange={(event) => setModelName(event.target.value)}
                                className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                {!testResult.models.includes(modelName) && (
                                    <option value={modelName}>{modelName}</option>
                                )}
                                {testResult.models.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                id={modelInputId}
                                value={modelName}
                                onChange={(event) => setModelName(event.target.value)}
                                className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            />
                        )}
                    </div>
                    {(provider !== "kimi" || kimiModelSupportsReasoningEffort(modelName)) && (
                        <div className="mt-4">
                            <label htmlFor={effortId} className="mb-1.5 block text-xs font-medium text-secondary">
                                {provider === "ollama" ? t("Thinking level") : t("Reasoning effort")}
                            </label>
                            <select
                                id={effortId}
                                value={reasoningEffort}
                                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                                className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            >
                                <option value="low">{t("Low")}</option>
                                <option value="high">{t("High")}</option>
                                <option value="max">{t("Maximum")}</option>
                            </select>
                        </div>
                    )}
                    {provider === "kimi" && !kimiModelSupportsReasoningEffort(modelName) && (
                        <p className="mt-4 text-xs text-muted-foreground">
                            {t("Thinking is always enabled for Kimi Code models.")}
                        </p>
                    )}
                    <div className="mt-5 rounded-md border border-border bg-background/60 p-3 text-xs text-secondary">
                        <div>
                            {t("Provider")}: {providerName}
                        </div>
                        <div className="mt-1">
                            {t("Mode key")}: {makeAIModeKey(provider, modelName)}
                        </div>
                    </div>
                    <div className="mt-5 flex justify-between gap-3">
                        <button
                            type="button"
                            onClick={() => setStep(2)}
                            className="min-h-10 cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm text-primary hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                        >
                            {t("Prev")}
                        </button>
                        <button
                            type="button"
                            onClick={saveConfiguration}
                            disabled={saving || !modelName.trim()}
                            className="min-h-10 cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {saving ? t("Saving...") : t("Save and use this model")}
                        </button>
                    </div>
                    <p className="mt-3 min-h-5 text-xs text-muted-foreground" aria-live="polite">
                        {status}
                    </p>
                </div>
            )}
        </SetupSection>
    );
}

export function WindowsSetupContent({ model }: { model: WaveConfigViewModel }) {
    const { t } = useTranslation();
    return (
        <div className="h-full overflow-y-auto bg-background p-5 @w700:p-8">
            <div className="mx-auto max-w-5xl">
                <header className="mb-6">
                    <h1 className="text-xl font-semibold text-primary">{t("Windows setup and diagnostics")}</h1>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary">
                        {t(
                            "Configure native Windows shells, validate SSH, and initialize Wave AI without editing JSON by hand."
                        )}
                    </p>
                </header>
                <div className="space-y-5">
                    <SSHDiagnostics model={model} />
                    <ShellManager model={model} />
                    <AISetupWizard model={model} />
                </div>
            </div>
        </div>
    );
}
