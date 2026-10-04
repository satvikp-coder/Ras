export type Row = Record<string, unknown>;
export interface Operator {
  id: number;
  name: string;
  username: string;
  role: string;
  active?: number;
}
export interface Member {
  name: string;
  contact?: string;
}
export interface Team {
  id: string;
  number: string;
  name: string;
  project: string;
  description: string;
  notes: string;
  status: string;
  balance: number;
  initial: number;
  spent: number;
  trade_paid: number;
  trade_received: number;
  received: number;
  purchase_count: number;
  trade_count: number;
  total_spent: number;
  total_trade_value: number;
  created_at: string;
  updated_at: string;
  members: Member[];
  mitra: Mitra | null;
  inventory: { id: string; name: string; quantity: number }[];
}
export interface Mitra {
  id: string;
  name: string;
  contact: string;
  notes: string;
  status: string;
  teams: { id: string; name: string; project: string; balance: number }[];
}
export interface Component {
  id: string;
  name: string;
  category: string;
  description: string;
  price: number;
  max_per_team: number | null;
  notes: string;
  status: string;
  stock: number;
  initial_quantity: number;
  purchased_quantity: number;
  refunded_quantity: number;
  traded_quantity: number;
}
export interface Timer {
  state: string;
  remaining_ms: number;
  elapsed_ms: number;
  started_at: string | null;
  ended_at: string | null;
  server_time: string;
}
export interface Config {
  eventName: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  currencyName: string;
  initialBolts: number;
  allocationConfirmed: boolean;
  rulesConfirmed: boolean;
  teamLimit: number | null;
  postEventEditing: boolean;
  allowBoltTransfer: boolean;
  allowItemTrading: boolean;
  allowItemForBolts: boolean;
  allowItemForItem: boolean;
  allowMixedTrades: boolean;
  allowRefunds: boolean;
  allowNegativeBalance: boolean;
  allowNegativeStock: boolean;
  maximumPurchaseQuantity: number | null;
}
export interface Summary {
  teams: number;
  activeTeams: number;
  mitras: number;
  purchases: number;
  trades: number;
  held: number;
  spent: number;
  transferred: number;
  sold: number;
  inventory: number;
  timer: Timer;
  popular: { component_id: string; component_name: string; quantity: number }[];
}
export interface Bootstrap {
  config: Config;
  timer: Timer;
  summary: Summary;
  teams: Team[];
  mitras: Mitra[];
  components: Component[];
  operators: Operator[];
  demo: boolean;
}
export interface History {
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}
export async function download(path: string, method = "GET") {
  const response = await fetch("/api" + path, { method });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error);
  }
  const blob = await response.blob();
  const filename =
    response.headers
      .get("Content-Disposition")
      ?.match(/filename="?([^";]+)"?/)?.[1] ?? "export";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
