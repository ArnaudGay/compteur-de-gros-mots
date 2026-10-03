<script lang="ts">
  import type { Player } from '../../core/types';

  let { player, me = false, size = 'md' }: { player: Pick<Player, 'name' | 'color'> | undefined; me?: boolean; size?: 'sm' | 'md' } = $props();
</script>

<span class="name {size}">
  <span class="dot" style:background={`var(--hue-${player?.color ?? 'blue'})`} aria-hidden="true"></span>
  <span class="text">{player?.name ?? '?'}</span>
  {#if me}<span class="me">moi</span>{/if}
</span>

<style>
  .name {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-weight: 600;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .sm {
    font-size: var(--t-sm);
    gap: 6px;
  }
  .sm .dot {
    width: 7px;
    height: 7px;
  }
  .me {
    flex: none;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
    border: 1px solid var(--rule-strong);
    border-radius: 3px;
    padding: 0 4px;
    line-height: 1.4;
  }
</style>
