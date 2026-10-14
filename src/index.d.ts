import type { Report, Rule } from './core.js';
export * from './core.js';

export interface EnginesGaugeOptions {
  /** Dependency name globs whose engines are ignored. */
  ignoreDeps?: string[];
  /** Require CI to test the engines.node minimum even when it is end-of-life. */
  strictMinimum?: boolean;
  /** Report a missing engines.node even for private packages. */
  requireEngines?: boolean;
  /** Reference date for LTS aliases and EOL checks. */
  now?: Date;
  toolVersion?: string;
}
export interface SemVer { major: number; minor: number; patch: number }
export declare const RULES: Record<string, Rule>;
export declare const RELEASES: Record<number, { codename?: string; eol: string }>;
export declare function check(dir: string, opts?: EnginesGaugeOptions, config?: Record<string, unknown>, configFile?: string): Report;
export declare function analyze(dir: string, opts?: EnginesGaugeOptions & { maxDeps?: number }): { pkg: Record<string, unknown>; info: Record<string, unknown>; findings: Report['findings'] };
export declare function satisfies(version: string, range: string): boolean;
export declare function minVersion(range: string): SemVer | null;
export declare function toMajor(spec: string | null | undefined, now?: Date): number | null;
export declare function isEol(major: number, now?: Date): boolean;
export declare function latestLts(now?: Date): number;
export declare function currentMajor(now?: Date): number;
export declare function workflowVersions(dir: string): { file: string; line: number; spec: string | null; via: string }[];
export declare function versionFiles(dir: string, pkg: Record<string, unknown>): { source: string; file: string; line?: number; spec: string }[];
export declare function dependencyEngines(dir: string, pkg: Record<string, unknown>): { source: string | null; deps: { name: string; version: string; node: string; dev: boolean; optional?: boolean }[] };
