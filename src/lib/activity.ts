/**
 * What the device is busy computing right now (separating, chords, lyrics),
 * for the header's compute badge.
 */

const running = new Map<number, string>();
const listeners = new Set<() => void>();
let nextId = 0;
let snapshot: string | null = null;

function update() {
  const labels = [...running.values()];
  snapshot = labels.length ? labels[labels.length - 1] : null;
  for (const l of listeners) l();
}

/** Marks work as running; call the returned function when it ends. */
export function beginActivity(label: string): () => void {
  const id = nextId++;
  running.set(id, label);
  update();
  return () => {
    running.delete(id);
    update();
  };
}

export const activityStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: (): string | null => null,
};
