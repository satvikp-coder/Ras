import { randomUUID } from "node:crypto";
import { FINAL_CONFIG, MARKET, STARTERS } from "./event-rules.mjs";

export function configureFinalEvent(store, admin) {
  store.requireAdmin(admin);
  return store.atomic(() => {
    if (
      store.get("SELECT id FROM purchases LIMIT 1") ||
      store.get("SELECT id FROM trades LIMIT 1")
    )
      throw new Error(
        "Final setup refuses to reset stock after commercial transactions. Reconcile existing event data first.",
      );
    store.timerAction(admin, "reset");
    store.saveConfig(admin, FINAL_CONFIG);
    if (!store.get("SELECT id FROM components WHERE id='JUMPER'"))
      store.saveComponent(admin, {
        id: "JUMPER",
        name: "Jumper wires",
        category: "Common",
        price: 0,
        initialQuantity: 0,
        status: "Inactive",
        description:
          "Free common workshop supply; excluded from purchases and trades.",
      });
    const keep = new Set([...MARKET, ...STARTERS].map((c) => c.id));
    for (const old of store.all("SELECT * FROM components")) {
      if (keep.has(old.id)) continue;
      const common = ["JUMPER", "MINI_BREADBOARD"].includes(old.id);
      store.saveComponent(
        admin,
        {
          ...old,
          status: "Inactive",
          category: common ? "Common" : "Reference",
          description: common
            ? "Free common workshop supplies; excluded from RAS Bolt purchases and trades."
            : "Retired planning stock; excluded from the competition market.",
          notes:
            "Final event setup: retained only as an inactive stock reference.",
        },
        old.id,
      );
    }
    for (const item of [
      ...MARKET.map((c) => ({ ...c, category: "Market" })),
      ...STARTERS.map((c) => ({
        ...c,
        price: 0,
        quantity: c.id === "BALL_CASTER" ? 2 : 0,
        category: "Starter",
      })),
    ]) {
      const old = store.get("SELECT * FROM components WHERE id=?", item.id);
      const input = {
        id: item.id,
        name: item.name,
        price: item.price,
        status: "Active",
        category: item.category,
        max_per_team: null,
        description:
          item.category === "Market"
            ? "Official Backstreet Market component."
            : "Free starter allocation; never purchased from market stock.",
        notes:
          item.id === "BALL_CASTER"
            ? "Two spare caster wheels reported in stock. Each team's starter caster is allocated separately, without consuming this spare stock."
            : "Final official event configuration, 7 October 2026.",
        initialQuantity: item.quantity,
      };
      store.saveComponent(admin, input, old ? item.id : null);
      const difference = item.quantity - store.stock(item.id);
      if (difference)
        store.adjustInventory(admin, {
          componentId: item.id,
          quantity: difference,
          notes: "Final official starting stock correction before competition",
          requestKey: randomUUID(),
        });
      if (old && old.initial_quantity !== item.quantity) {
        store.run(
          "UPDATE components SET initial_quantity=? WHERE id=?",
          item.quantity,
          item.id,
        );
        store.audit(
          admin,
          "FINAL_STARTING_STOCK",
          "component",
          item.id,
          { initial_quantity: old.initial_quantity },
          { initial_quantity: item.quantity },
          "Authoritative final event stock replaces preliminary planning quantities before any purchases.",
        );
      }
    }
    for (const team of store.all("SELECT id FROM teams")) {
      const initial = store.teamDetails(team.id).initial;
      if (initial !== 1000)
        store.adjustment(admin, {
          teamId: team.id,
          type: "INITIAL_BALANCE",
          amount: 1000 - initial,
          notes:
            "Final official allocation corrected to 1000 RAS Bolts before competition",
          requestKey: randomUUID(),
        });
      store.allocateStarters(admin, team.id);
    }
    return {
      config: store.config(),
      market: MARKET.map((c) => ({
        name: c.name,
        price: store.component(c.id).price,
        stock: store.stock(c.id),
      })),
      timer: store.timer(),
    };
  });
}
