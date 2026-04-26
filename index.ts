/**
 * pi-minimax-status
 * MiniMax Usage Status Bar for pi coding agent
 * 
 * Features:
 * - Live status bar bottom-right (VanJS-style Unicode bars)
 * - Daily + Weekly usage tracking
 * - Configurable hex colors (amber/orange defaults)
 * - Only refreshes when session active (not idle)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

// ═══════════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════════

interface Config {
  apiKey: string;
  groupId: string;
  colors: {
    bar: string;        // Default: #FFA500 (amber)
    barWarning: string; // Default: #FF8C00 (dark orange)
    barDanger: string;  // Default: #FF4500 (orange red)
    text: string;       // Default: #FFB347 (light amber)
    bg: string;         // Default: #1a1a1a (dark)
  };
  thresholds: {
    warning: number;    // Default: 60
    danger: number;     // Default: 85
  };
  refreshInterval: number; // Default: 60000 (1 minute)
  barLength: number;       // Default: 10
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
// Config
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
let refreshInterval: NodeJS.Timeout | null = null;
let extCtx: ExtensionContext | null = null;

// ═══════════════════════════════════════════════════════════════════════════════
// Config File Management
// ═══════════════════════════════════════════════════════════════════════════════

function getConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return `${home}/.config/pi-minimax-status/config.json`;
}

function loadConfig(): Config {
  try {
    const fs = require("fs");
    const path = getConfigPath();
    if (fs.existsSync(path)) {
      const raw = fs.readFileSync(path, "utf-8");
      const saved = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...saved,
        colors: { ...DEFAULT_CONFIG.colors, ...saved.colors },
        thresholds: { ...DEFAULT_CONFIG.thresholds, ...saved.thresholds },
      };
    }
  } catch (e) {
    // Use defaults
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(): void {
  try {
    const fs = require("fs");
    const path = getConfigPath();
    const dir = require("path").dirname(path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path, JSON.stringify(config, null, 2));
  } catch (e) {
    // Ignore
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Usage Tracking (LocalStorage-like via file)
// ═══════════════════════════════════════════════════════════════════════════════

function getUsagePath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "~";
  return `${home}/.config/pi-minimax-status/usage.json`;
}

function loadUsageData(): UsageData {
  try {
    const fs = require("fs");
    const path = getUsagePath();
    if (fs.existsSync(path)) {
      return JSON.parse(fs.readFileSync(path, "utf-8"));
    }
  } catch (e) {
    // Ignore
  }
  return { daily: [], weekly: [], lastFetch: 0 };
}

function saveUsageData(data: UsageData): void {
  try {
    const fs = require("fs");
    const path = getUsagePath();
    const dir = require("path").dirname(path);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path, JSON.stringify(data));
  } catch (e) {
    // Ignore
  }
}

function pruneOldSnapshots(data: UsageData): void {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  // Keep snapshots from last 7 days
  data.weekly = data.weekly.filter(s => now - s.timestamp < 7 * dayMs);
  
  // Keep snapshots from last 24 hours
  data.daily = data.daily.filter(s => now - s.timestamp < dayMs);
}

function calculateUsage(): { daily: number; weekly: number } {
  const data = loadUsageData();
  pruneOldSnapshots(data);

  // Get today's usage (sum of used counts from today's snapshots)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayUsage = data.daily
    .filter(s => s.timestamp >= todayStart.getTime())
    .reduce((sum, s) => sum + s.used, 0);

  // Get weekly usage (sum of all weekly snapshots)
  const weeklyUsage = data.weekly.reduce((sum, s) => sum + s.used, 0);

  return { daily: todayUsage, weekly: weeklyUsage };
}

function recordSnapshot(used: number, total: number, remains: number): void {
  const data = loadUsageData();
  const snapshot: UsageSnapshot = {
    timestamp: Date.now(),
    used,
    total,
    remains,
  };

  data.daily.push(snapshot);
  data.weekly.push(snapshot);
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

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    
    if (json.base_resp?.status_code !== 0) {
      return null;
    }

    const model = json.model_remains?.[0];
    if (!model) return null;

    return {
      used: model.current_interval_usage_count || 0,
      total: model.current_interval_total_count || 0,
      remains: model.remains_count || 0,
    };
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI Rendering (VanJS-style reactive)
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
  const color = getColor(percent);
  const colorAnsi = hexToAnsi(color);
  
  return `${colorAnsi}${"█".repeat(filled)}${"░".repeat(empty)}${RESET}`;
}

function renderStatus(): string {
  // Max expected usage per day/week (assume 1500 prompts for calculation)
  const maxDaily = 1500;
  const maxWeekly = 10000;

  const dailyPercent = Math.min(100, (currentUsage.daily / maxDaily) * 100);
  const weeklyPercent = Math.min(100, (currentUsage.weekly / maxWeekly) * 100);

  const textColor = hexToAnsi(config.colors.text);
  const bgColor = hexToAnsi(config.colors.bg);

  const dailyBar = renderBar(dailyPercent);
  const weeklyBar = renderBar(weeklyPercent);

  return `${bgColor}${textColor}[D:${dailyBar}${Math.round(dailyPercent)}%][W:${weeklyBar}${Math.round(weeklyPercent)}%]${RESET}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Extension
// ═══════════════════════════════════════════════════════════════════════════════

export default async function (pi: ExtensionAPI): Promise<void> {
  // Load config
  config = loadConfig();

  // Register config tool
  pi.registerTool({
    name: "minimax_config",
    label: "MiniMax Config",
    description: "Configure MiniMax status plugin",
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
      
      // Refresh display
      updateStatus();

      return {
        content: [{ type: "text", text: "MiniMax config updated. Status bar refreshed." }],
        details: { config },
      };
    },
  });

  // Register refresh tool
  pi.registerTool({
    name: "minimax_refresh",
    label: "MiniMax Refresh",
    description: "Manually refresh MiniMax usage data",
    parameters: Type.Object({}),
    async execute() {
      await refreshUsage();
      return {
        content: [{ type: "text", text: `Usage refreshed: D=${currentUsage.daily}, W=${currentUsage.weekly}` }],
        details: currentUsage,
      };
    },
  });

  // Event handlers
  pi.on("session_start", async (_event, ctx) => {
    extCtx = ctx;
    startRefreshLoop();
    await refreshUsage();
  });

  pi.on("session_shutdown", () => {
    stopRefreshLoop();
    extCtx = null;
  });

  pi.on("turn_start", () => {
    // Session just became active - ensure refresh
    if (!refreshInterval) {
      startRefreshLoop();
    }
  });

  // Register command for manual config
  pi.registerCommand("minimax", {
    description: "MiniMax status - use minimax_config or minimax_refresh",
    handler: async (args, ctx) => {
      if (args === "status") {
        await refreshUsage();
        ctx.ui.notify(renderStatus(), "info");
      } else if (args === "refresh") {
        await refreshUsage();
        ctx.ui.notify("Usage refreshed", "success");
      } else {
        ctx.ui.notify("Commands: /minimax status | /minimax refresh", "info");
      }
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Refresh Logic
// ═══════════════════════════════════════════════════════════════════════════════

async function refreshUsage(): Promise<void> {
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
  
  const status = renderStatus();
  extCtx.ui.setStatus("minimax", status);
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
