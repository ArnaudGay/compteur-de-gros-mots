<script lang="ts">
  import { SUGGESTED_WORDS } from '../../core/defaults';
  import { HOUR } from '../../core/time';
  import { toLocalInput, TZ } from '../lib/format';
  import { app } from '../lib/state.svelte';
  import { zonedToUtc } from '../../core/time';
  import Icon from './Icon.svelte';
  import Sheet from './Sheet.svelte';

  let { targetId, onClose }: { targetId: string; onClose: () => void } = $props();

  let name = $derived(app.name(targetId));
  let count = $state(1);
  let when = $state(toLocalInput(app.serverNow() - HOUR));
  let note = $state('');
  let word = $state<string | null>(null);
  let busy = $state(false);
  let isMe = $derived(targetId === app.meId);

  function quick(n: number) {
    onClose();
    app.tap(targetId, n);
  }

  /** « 2026-10-03T14:32 » saisi à l'heure de Paris → instant UTC. */
  function parseLocal(value: string): number | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
    if (!m) return null;
    return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), TZ);
  }

  async function addLate(event: SubmitEvent) {
    event.preventDefault();
    const at = parseLocal(when);
    if (at === null) return app.info("L'heure n'est pas valide.");
    busy = true;
    const ok = await app.addManual(targetId, count, at, note.trim() || null, word);
    busy = false;
    if (ok) onClose();
  }
</script>

<Sheet title={name} {onClose}>
  <h3 class="eyebrow">Maintenant</h3>
  <div class="quick">
    {#each [2, 3, 5] as n (n)}
      <button type="button" class="btn big" onclick={() => quick(n)}>+{n}</button>
    {/each}
  </div>
  <p class="hint muted">Plusieurs gros mots d'affilée. Si un autre témoin les compte aussi, ils ne comptent qu'une fois.</p>

  <h3 class="eyebrow">Rattraper un oubli</h3>
  <form class="list late" onsubmit={addLate}>
    <div class="row">
      <span class="grow">Nombre</span>
      <div class="stepper">
        <button type="button" aria-label="Moins" onclick={() => (count = Math.max(1, count - 1))} disabled={count <= 1}><Icon name="minus" size={18} /></button>
        <span class="value display" aria-live="polite">{count}</span>
        <button type="button" aria-label="Plus" onclick={() => (count = Math.min(20, count + 1))} disabled={count >= 20}><Icon name="plus" size={18} /></button>
      </div>
    </div>
    <div class="row">
      <label class="grow" for="late-when">Quand</label>
      <input id="late-when" class="input when" type="datetime-local" bind:value={when} max={toLocalInput(app.serverNow())} required />
    </div>
    <div class="row">
      <label class="sr-only" for="late-note">Note</label>
      <input id="late-note" class="input" maxlength="140" placeholder={isMe ? "Note (ex. au boulot, sur l'honneur)" : 'Note (ex. soirée foot)'} bind:value={note} />
    </div>
    <div class="row words">
      {#each SUGGESTED_WORDS.slice(0, 6) as w (w)}
        <button type="button" class="chip" class:on={word === w} onclick={() => (word = word === w ? null : w)}>{w}</button>
      {/each}
    </div>
    <div class="row">
      <button class="btn primary block" type="submit" disabled={busy}>Ajouter {count} point{count > 1 ? 's' : ''} à {name}</button>
    </div>
  </form>
</Sheet>

<style>
  h3 {
    margin: 14px 4px 8px;
  }
  .quick {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .big {
    min-height: 56px;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 1.6rem;
  }
  .hint {
    font-size: var(--t-sm);
    margin: 8px 4px 0;
  }
  .late .row {
    flex-wrap: wrap;
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .stepper button {
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid var(--rule-strong);
    background: var(--panel);
  }
  .stepper button:disabled {
    opacity: 0.4;
  }
  .value {
    min-width: 34px;
    text-align: center;
    font-size: 1.6rem;
  }
  .when {
    width: auto;
    flex: 1;
    min-width: 0;
  }
  .words {
    gap: 6px;
  }
  .chip {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 17px;
    border: 1px solid var(--rule-strong);
    background: var(--panel);
    font-size: var(--t-sm);
    font-weight: 600;
  }
  .chip.on {
    background: var(--ink);
    border-color: var(--ink);
    color: var(--paper);
  }
</style>
