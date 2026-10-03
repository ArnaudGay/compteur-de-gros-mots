<script lang="ts">
  import { listing } from '../../core/french';
  import type { LastPoint, Player } from '../../core/types';
  import { ago } from '../lib/format';
  import FlipNumber from './FlipNumber.svelte';
  import Icon from './Icon.svelte';
  import Tally from './Tally.svelte';

  let {
    player,
    total,
    today,
    last,
    isMe = false,
    now,
    names,
    readonly = false,
    onTap,
    onMore,
  }: {
    player: Player;
    total: number;
    today: number;
    last: LastPoint | null;
    isMe?: boolean;
    now: number;
    names: (id: string) => string;
    readonly?: boolean;
    onTap?: () => void;
    onMore?: () => void;
  } = $props();

  // La case s'allume en jaune « carton » à chaque nouveau point, chez tout le monde.
  let flash = $state<'' | 'a' | 'b'>('');
  let previous: number | null = null;
  $effect(() => {
    const value = total;
    if (previous !== null && value > previous) flash = flash === 'a' ? 'b' : 'a';
    previous = value;
  });

  let fresh = $derived(last !== null && now - last.at < 10 * 60_000);
  let footer = $derived.by(() => {
    if (!last) return 'aucun gros mot';
    const when = ago(last.at, now);
    if (!fresh || last.reporterIds.length === 0) return when;
    const who = last.reporterIds.length === 1 && last.reporterIds[0] === player.id ? 'autodénonciation' : `par ${listing(last.reporterIds.map(names))}`;
    return `${when} · ${who}`;
  });
  let digits = $derived(String(total).length);
  let numberSize = $derived(`min(${(80 / (0.53 * Math.max(digits, 2))).toFixed(1)}cqw, 52cqh)`);
</script>

<div class="tile" class:flash-a={flash === 'a'} class:flash-b={flash === 'b'} class:readonly>
  {#if !readonly}
    <button class="hit" type="button" aria-label="Compter un gros mot pour {player.name} ({total} point{total > 1 ? 's' : ''})" onclick={onTap}></button>
  {/if}
  <div class="head">
    <span class="dot" style:background={`var(--hue-${player.color})`} aria-hidden="true"></span>
    <span class="name">{player.name}</span>
    {#if isMe}<span class="me">moi</span>{/if}
  </div>
  {#if !readonly}
    <button class="more" type="button" aria-label="Plus d'options pour {player.name}" onclick={onMore}>
      <Icon name="more" size={22} />
    </button>
  {/if}
  <div class="score" style:font-size={numberSize}>
    <FlipNumber value={total} label="{total} point{total > 1 ? 's' : ''}" />
  </div>
  <div class="today"><Tally count={today} /></div>
  <div class="foot" class:fresh>{footer}</div>
</div>

<style>
  .tile {
    --tile-bg: var(--panel);
    position: relative;
    container-type: size;
    display: grid;
    grid-template-rows: auto 1fr auto auto;
    min-height: 0;
    padding: 10px 12px 10px 13px;
    border-radius: var(--radius);
    background: var(--tile-bg);
    color: var(--ink);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    transition: transform 140ms var(--ease);
  }
  .tile:has(.hit:active) {
    transform: scale(0.985);
    --tile-bg: var(--sunken);
  }
  .flash-a {
    animation: flash-a 1300ms ease-out;
  }
  .flash-b {
    animation: flash-b 1300ms ease-out;
  }
  @keyframes flash-a {
    0%,
    25% {
      --tile-bg: var(--card);
      color: var(--card-ink);
    }
    100% {
      --tile-bg: var(--panel);
      color: var(--ink);
    }
  }
  @keyframes flash-b {
    0%,
    25% {
      --tile-bg: var(--card);
      color: var(--card-ink);
    }
    100% {
      --tile-bg: var(--panel);
      color: var(--ink);
    }
  }
  .hit {
    position: absolute;
    inset: 0;
    z-index: 1;
    border: 0;
    padding: 0;
    background: transparent;
    border-radius: inherit;
  }
  .hit:focus-visible {
    outline-offset: -3px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding-right: 30px;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1.3rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    line-height: 1;
    padding-top: 2px;
  }
  .me {
    flex: none;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 0 4px;
    line-height: 1.5;
    opacity: 0.7;
  }
  .more {
    position: absolute;
    top: 2px;
    right: 2px;
    z-index: 2;
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.55;
    border-radius: var(--radius);
  }
  .score {
    align-self: center;
    justify-self: center;
    line-height: 1;
    padding-block: 2px;
  }
  .today {
    display: flex;
    justify-content: center;
    min-height: 22px;
    color: inherit;
  }
  .foot {
    margin-top: 4px;
    font-size: var(--t-xs);
    color: var(--ink-3);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .flash-a .foot,
  .flash-b .foot {
    color: inherit;
  }
  .foot.fresh {
    color: var(--ink);
    font-weight: 600;
  }
  .readonly .head {
    padding-right: 0;
  }
</style>
