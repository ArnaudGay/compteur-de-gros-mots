// Diffusion temps réel (Server-Sent Events) vers tous les téléphones connectés.

export interface Client {
  id: number;
  /** Session du joueur connecté, ou null pour un spectateur. */
  sessionId: string | null;
  /** Lien spectateur utilisé, ou null pour un joueur. */
  linkId: string | null;
  send: (event: string, data: string) => void;
  close: () => void;
}

/** Flux ouverts en même temps au plus : par appareil connecté, et par lien spectateur. */
const MAX_PER_SESSION = 4;
const MAX_PER_LINK = 20;

export class Hub {
  private clients = new Map<number, Client>();
  private nextId = 1;

  add(client: Omit<Client, 'id'>): Client {
    const full = { ...client, id: this.nextId++ };
    this.clients.set(full.id, full);
    // Au-delà, on ferme les plus anciens (souvent des connexions mortes qu'iOS n'a pas signalées).
    const siblings = [...this.clients.values()].filter(
      (c) => (full.sessionId !== null && c.sessionId === full.sessionId) || (full.linkId !== null && c.linkId === full.linkId),
    );
    const max = full.linkId !== null ? MAX_PER_LINK : MAX_PER_SESSION;
    for (const old of siblings.slice(0, Math.max(0, siblings.length - max))) {
      old.close();
      this.clients.delete(old.id);
    }
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

  /** Coupe les flux ouverts avec un lien spectateur révoqué. */
  disconnectLink(linkId: string): void {
    for (const client of [...this.clients.values()]) {
      if (client.linkId === linkId) {
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
