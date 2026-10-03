// Diffusion temps réel (Server-Sent Events) vers tous les téléphones connectés.

export interface Client {
  id: number;
  /** Session du joueur connecté, ou null pour un spectateur. */
  sessionId: string | null;
  send: (event: string, data: string) => void;
  close: () => void;
}

export class Hub {
  private clients = new Map<number, Client>();
  private nextId = 1;

  add(client: Omit<Client, 'id'>): Client {
    const full = { ...client, id: this.nextId++ };
    this.clients.set(full.id, full);
    return full;
  }

  remove(id: number): void {
    this.clients.delete(id);
  }

  get size(): number {
    return this.clients.size;
  }

  broadcast(event: string, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const client of this.clients.values()) {
      try {
        client.send(event, data);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  /** Coupe le flux d'une session (déconnexion, appareil révoqué). */
  disconnectSession(sessionId: string): void {
    for (const client of [...this.clients.values()]) {
      if (client.sessionId === sessionId) {
        client.close();
        this.clients.delete(client.id);
      }
    }
  }

  closeAll(): void {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}
