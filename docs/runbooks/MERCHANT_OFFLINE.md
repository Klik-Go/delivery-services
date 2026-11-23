# Runbook: store offline

**When:** a store doesn't answer orders, its phone is off, it closed early, or it ran out of
food.
**Who:** the zone coordinator.

1. Orders already waiting: follow [Order stuck](ORDER_STUCK.md) (call; cancel if they can't cook).
2. Stop new orders:
   - Ask the owner to tap **Close the store** on their dashboard (or mark items sold out).
   - If you can't reach them: an admin uses **Stores → Suspend** with the reason "Not answering
     orders <date>". The store disappears from the app at once; history stays.
3. Tell customers whose orders were cancelled (they get the text/push automatically; call for
   big orders).
4. When the store is back: the owner taps **Open the store**, or an admin sets the store **Active** again.
5. A store that misses the deadline often appears on the KPI dashboard (confirmation time) and in
   **Low ratings**; discuss it in the weekly review (penalty policy: Q26).
