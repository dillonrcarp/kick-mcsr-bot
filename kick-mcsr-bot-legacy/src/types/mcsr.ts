export interface LastMatchResult extends Record<string, unknown> {
  uuid?: string;
  time?: number;
}

export interface LastMatchChange extends Record<string, unknown> {
  uuid?: string;
  change?: number;
}

export interface LastMatchPlayer extends Record<string, unknown> {
  uuid?: string;
  nickname?: string;
  name?: string;
  username?: string;
}

export interface LastMatch extends Record<string, unknown> {
  result?: LastMatchResult | null;
  changes?: LastMatchChange[] | null;
  players?: LastMatchPlayer[] | null;
  forfeited?: boolean;
}
