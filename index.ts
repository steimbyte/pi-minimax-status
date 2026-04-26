/**
 * pi-minimax-status
 * MiniMax Usage Status Bar for pi coding agent
 * 
 * Features:
 * - Live status bar bottom-right (VanJS-style Unicode bars)
 * - Daily + Weekly usage tracking
 * - Configurable hex colors (amber/orange defaults)
 * - Auto-detect credentials from env, .env, pi settings
 * - Prompt user via UI if no credentials found
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface Config {
  apiKey: string;
  groupId: string;
  colors: {
    bar: string;
    barWarning: string;
    barDanger: string;
    text: string;
    bg: string;
  };
  thresholds: {
    warning: number;
    danger: number;
  };
  refreshInterval: number;
  barLength: number;
}

interface UsageSnapshot {
  timestamp: number;
  used: number;
  total: number;
  remains: number;
}

interface UsageData {
  daily: UsageSnapshot[];
  weekly: UsageSnapshot[];
  lastFetch: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default Config
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: Config = {
  apiKey: "",
  groupId: "",
  colors: {
    bar: "#FFA500",
    barWarning: "#FF8C00",
    barDanger: "#FF4500",
    text: "#FFB347",
    bg: "#1a1a1a",
  },
  thresholds: {
    warning: 60,
    danger: 85,
  },
  refreshInterval: 60000,
  barLength: 10,
};

// ═══════════════════════════════════════════════════════════════════════════════
// State
// ═══════════════════════════════════════════════════════════════════════════════

let config: Config = { ...DEFAULT_CONFIG };
let currentUsage: { daily: number; weekly: number } = { daily: 0, weekly: 0 };
let lastRefresh: number = 0;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let extCtx: ExtensionContext | null = null;
let isInitialized = false;
let credentialsPrompted = false;

// ═══════════════════════════════════════════════════════════════════════════════
// Paths
// ═══════════════════════════════════════════════════════════════════════════════

function getConfigDir(): string {
  return path.join(os.homedir(), ".config", "pi-minimax-status");
}

function getConfigPath(): string {
  return path.join(getConfigDir(), "config.json");
}

function getUsagePath(): string {
  return path.join(getConfigDir(), "usage.json");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Credential Detection
// ═══════════════════════════════════════════════════════════════════════════════

interface DetectedCredentials {
  apiKey: string;
  groupId: string;
}

function detectCredentials(): DetectedCredentials | null {
  // 1. Check environment variables
  if (process.env.MINIMAX_API_KEY && process.env.MINIMAX_GROUP_ID) {
    console.log("[minimax-status] Credentials from env vars");
    return { apiKey: process.env.MINIMAX_API_KEY, groupId: process.env.MINIMAX_GROUP_ID };
  }
  if (process.env.MINIMAX_CODING_API_KEY && process.env.MINIMAX_GROUP_ID) {
    console.log("[minimax-status] Credentials from env vars (MINIMAX_CODING_API_KEY)");
    return { apiKey: process.env.MINIMAX_CODING_API_KEY, groupId: process.env.MINIMAX_GROUP_ID };
  }

  // 2. Check .env files
  const envPaths = [
    path.join(os.homedir(), ".env"),
    path.join(os.homedir(), ".minimax", ".env"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), ".config", "minimax", ".env"),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      const apiKeyMatch = content.match(/MINIMAX[_]?[CODING]?[APIKEY]?=\s*(.+)/i);
      const groupIdMatch = content.match(/MINIMAX[_]?GROUP[ID]?=\s*(.+)/i);
      
      if (apiKeyMatch && groupIdMatch) {
        console.log("[minimax-status] Credentials from .env:", envPath);
        return { apiKey: apiKeyMatch[1].trim(), groupId: groupIdMatch[1].trim() };
      }
    }
  }

  // 3. Check pi settings.json
  const piSettingsPath = path.join(os.homedir(), ".config", "opencode", "settings.json");
  if (fs.existsSync(piSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(piSettingsPath, "utf-8"));
      if (settings.minimaxApiKey && settings.minimaxGroupId) {
        console.log("[minimax-status] Credentials from pi settings");
        return { apiKey: settings.minimaxApiKey, groupId: settings.minimaxGroupId };
      }
      if (settings.MINIMAX_API_KEY && settings.MINIMAX_GROUP_ID) {
        console.log("[minimax-status] Credentials from pi settings");
        return { apiKey: settings.MINIMAX_API_KEY, groupId: settings.MINIMAX_GROUP_ID };
      }
    } catch (e) {
      // Ignore
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Config Management
// ═══════════════════════════════════════════════════════════════════════════════

function loadConfig(): Config {
  const cfgPath = getConfigPath();
  
  // Create default config if not exists
  if (!fs.existsSync(cfgPath)) {
    const cfgDir = getConfigDir();
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    
    // Try auto-detect first
    const detected = detectCredentials();
    const cfg: Config = {
      ...DEFAULT_CONFIG,
      ...(detected ? { apiKey: detected.apiKey, groupId: detected.groupId } : {}),
      colors: {
        bar: "#FFA500",
        barWarning: "#FF8C00",
        barDanger: "#FF4500",
        text: "#FFB347",
        bg: "#1a1a1a",
      },
    };
    
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    return cfg;
  }

  try {
    const raw = fs.readFileSync(cfgPath, "utf-8");
    const saved = JSON.parse(raw);
    
    // Merge with defaults, prefer saved values
    const merged: Config = {
      ...DEFAULT_CONFIG,
      ...saved,
      colors: { ...DEFAULT_CONFIG.colors, ...saved.colors },
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...saved.thresholds },
    };
    
    // If no credentials in config, try auto-detect
    if (!merged.apiKey || !merged.groupId) {
      const detected = detectCredentials();
      if (detected) {
        merged.apiKey = detected.apiKey;
        merged.groupId = detected.groupId;
        saveConfig(merged);
      }
    }
    
    return merged;
  } catch (e) {
    console.error("[minimax-status] Config load error:", e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg?: Config): void {
  try {
    const cfgDir = getConfigDir();
    if (!fs.existsSync(cfgDir)) {
      fs.mkdirSync(cfgDir, { recursive: true });
    }
    fs.writeFileSync(getConfigPath(), JSON.stringify(cfg || config, null, 2));
  } catch (e) {
    console.error("[minimax-status] Config save error:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Usage Tracking
// ═══════════════════════════════════════════════════════════════════════════════

function loadUsageData(): UsageData {
  try {
    if (fs.existsSync(getUsagePath())) {
      return JSON.parse(fs.readFileSync(getUsagePath(), "utf-8"));
    }
  } catch (e) {}
  return { daily: [], weekly: [], lastFetch: 0 };
}

function saveUsageData(data: UsageData): void {
  try {
    const dir = getConfigDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getUsagePath(), JSON.stringify(data));
  } catch (e) {}
}

function pruneOldSnapshots(data: UsageData): void {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  data.weekly = data.weekly.filter(s => now - s.timestamp < 7 * dayMs);
  data.daily = data.daily.filter(s => now - s.timestamp < dayMs);
}

function calculateUsage(): { daily: number; weekly: number } {
  const data = loadUsageData();
  pruneOldSnapshots(data);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayUsage = data.daily
    .filter(s => s.timestamp >= todayStart.getTime())
    .reduce((sum, s) => sum + s.used, 0);
  const weeklyUsage = data.weekly.reduce((sum, s) => sum + s.used, 0);

  return { daily: todayUsage, weekly: weeklyUsage };
}

function recordSnapshot(used: number, total: number, remains: number): void {
  const data = loadUsageData();
  data.daily.push({ timestamp: Date.now(), used, total, remains });
  data.weekly.push({ timestamp: Date.now(), used, total, remains });
  data.lastFetch = Date.now();
  pruneOldSnapshots(data);
  saveUsageData(data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MiniMax API
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchUsage(): Promise<{ used: number; total: number; remains: number } | null> {
  if (!config.apiKey || !config.groupId) {
    return null;
  }

  try {
    const url = `https://platform.minimax.io/v1/api/openplatform/coding_plan/remains?GroupId=${config.groupId}`;
    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Accept": "application/json",
        "Referer": "https://platform.minimax.io/user-center/payment/coding-plan",
        "User-Agent": "pi-minimax-status/1.0.0",
      },
    });

    if (!response.ok) return null;
    const json = await response.json();
    if (json.base_resp?.status_code !== 0) return null;

    const model = json.model_remains?.[0];
    if (!model) return null;

    return {
      used: model.current_interval_usage_count || 0,
      total: model.current_interval_total_count || 0,
      remains: model.remains_count || 0,
    };
  } catch (e) {
    console.error("[minimax-status] Fetch error:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Rendering
// ═══════════════════════════════════════════════════════════════════════════════

function hexToAnsi(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const RESET = "\x1b[0m";

function getColor(percent: number): string {
  if (percent >= config.thresholds.danger) return config.colors.barDanger;
  if (percent >= config.thresholds.warning) return config.colors.barWarning;
  return config.colors.bar;
}

function renderBar(percent: number): string {
  const filled = Math.round((percent / 100) * config.barLength);
  const empty = config.barLength - filled;
  return `${hexToAnsi(getColor(percent))}${"█".repeat(filled)}${"░".repeat(empty)}${RESET}`;
}

function renderStatus(): string {
  const maxDaily = 1500;
  const maxWeekly = 10000;
  const dailyPercent = Math.min(100, (currentUsage.daily / maxDaily) * 100);
  const weeklyPercent = Math.min(100, (currentUsage.weekly / maxWeekly) * 100);

  return `${hexToAnsi(config.colors.bg)}${hexToAnsi(config.colors.text)}[D:${renderBar(dailyPercent)}${Math.round(dailyPercent)}%][W:${renderBar(weeklyPercent)}${Math.round(weeklyPercent)}%]${RESET}`;
}

function renderSetupStatus(): string {
  return `${hexToAnsi(config.colors.barDanger)}[MiniMax: SETUP NEEDED]${RESET}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Setup Prompt
// ═══════════════════════════════════════════════════════════════════════════════

async function promptForCredentials(): Promise<boolean> {
  if (!extCtx || credentialsPrompted) return false;
  credentialsPrompted = true;

  extCtx.ui.notify("MiniMax: Please enter your API Key and Group ID", "warning");
  
  try {
    const apiKey = await extCtx.ui.input("MiniMax API Key", "Enter your MiniMax Coding Plan API Key");
    if (!apiKey) return false;

    const groupId = await extCtx.ui.input("MiniMax Group ID", "Enter your MiniMax Group ID");
    if (!groupId) return false;

    config.apiKey = apiKey;
    config.groupId = groupId;
    saveConfig();

    extCtx.ui.notify("MiniMax credentials saved!", "success");
    return true;
  } catch (e) {
    console.error("[minimax-status] Prompt error:", e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Extension
// ═══════════════════════════════════════════════════════════════════════════════

export default async function (pi: ExtensionAPI): Promise<void> {
  console.log("[minimax-status] Loading...");
  config = loadConfig();

  // Show setup status if no credentials
  pi.on("session_start", async (_event, ctx) => {
    console.log("[minimax-status] Session started");
    extCtx = ctx;
    isInitialized = true;

    // Check credentials
    if (!config.apiKey || !config.groupId) {
      updateStatus(); // Show setup needed
      await promptForCredentials();
    }

    await refreshUsage();
    startRefreshLoop();
  });

  pi.on("session_shutdown", () => {
    stopRefreshLoop();
    extCtx = null;
    isInitialized = false;
  });

  pi.on("turn_start", () => {
    if (isInitialized && extCtx) refreshUsage();
  });

  // Register tools
  pi.registerTool({
    name: "minimax_config",
    label: "MiniMax Config",
    description: "Configure MiniMax status",
    parameters: Type.Object({
      apiKey: Type.Optional(Type.String()),
      groupId: Type.Optional(Type.String()),
      colorBar: Type.Optional(Type.String()),
      colorBarWarning: Type.Optional(Type.String()),
      colorBarDanger: Type.Optional(Type.String()),
      colorText: Type.Optional(Type.String()),
      colorBg: Type.Optional(Type.String()),
      thresholdWarning: Type.Optional(Type.Number()),
      thresholdDanger: Type.Optional(Type.Number()),
      barLength: Type.Optional(Type.Number()),
    }),
    async execute(_toolCallId, params) {
      if (params.apiKey) config.apiKey = params.apiKey;
      if (params.groupId) config.groupId = params.groupId;
      if (params.colorBar) config.colors.bar = params.colorBar;
      if (params.colorBarWarning) config.colors.barWarning = params.colorBarWarning;
      if (params.colorBarDanger) config.colors.barDanger = params.colorBarDanger;
      if (params.colorText) config.colors.text = params.colorText;
      if (params.colorBg) config.colors.bg = params.colorBg;
      if (params.thresholdWarning) config.thresholds.warning = params.thresholdWarning;
      if (params.thresholdDanger) config.thresholds.danger = params.thresholdDanger;
      if (params.barLength) config.barLength = params.barLength;
      saveConfig();
      updateStatus();
      return {
        content: [{ type: "text", text: "Config updated." }],
      };
    },
  });

  pi.registerTool({
    name: "minimax_refresh",
    label: "MiniMax Refresh",
    description: "Refresh usage data",
    parameters: Type.Object({}),
    async execute() {
      await refreshUsage();
      return {
        content: [{ type: "text", text: `D=${currentUsage.daily}, W=${currentUsage.weekly}` }],
      };
    },
  });

  pi.registerCommand("minimax", {
    description: "MiniMax status",
    handler: async (args, ctx) => {
      if (args === "setup") {
        credentialsPrompted = false;
        await promptForCredentials();
      } else if (args === "refresh") {
        await refreshUsage();
        ctx.ui.notify("Refreshed", "success");
      } else if (args === "config") {
        ctx.ui.notify(JSON.stringify(config, null, 2), "info");
      } else {
        ctx.ui.notify("Commands: /minimax setup | refresh | config", "info");
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Refresh Logic
// ═══════════════════════════════════════════════════════════════════════════════

async function refreshUsage(): Promise<void> {
  if (!config.apiKey || !config.groupId) {
    updateStatus();
    return;
  }

  const data = await fetchUsage();
  if (data) {
    recordSnapshot(data.used, data.total, data.remains);
    currentUsage = calculateUsage();
  }
  lastRefresh = Date.now();
  updateStatus();
}

function updateStatus(): void {
  if (!extCtx) return;
  
  if (!config.apiKey || !config.groupId) {
    extCtx.ui.setStatus("minimax", renderSetupStatus());
  } else {
    extCtx.ui.setStatus("minimax", renderStatus());
  }
}

function startRefreshLoop(): void {
  if (refreshInterval) return;
  refreshInterval = setInterval(async () => {
    if (extCtx && !extCtx.isIdle()) {
      await refreshUsage();
    }
  }, config.refreshInterval);
}

function stopRefreshLoop(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}
