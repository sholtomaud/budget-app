/** Store, after Boba: an EventTarget that emits `change` with the new state. */
export class Store<T extends object> extends EventTarget {
  private state: T;

  constructor(initialState: T) {
    super();
    this.state = { ...initialState };
  }

  getState(): T {
    return { ...this.state };
  }

  setState(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent<T>('change', { detail: this.getState() }));
  }

  /** Subscribe to changes; returns the unsubscribe function. */
  subscribe(fn: (state: T) => void): () => void {
    const listener = (e: Event) => fn((e as CustomEvent<T>).detail);
    this.addEventListener('change', listener);
    return () => this.removeEventListener('change', listener);
  }
}
