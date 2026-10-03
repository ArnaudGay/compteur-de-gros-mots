<script lang="ts">
  // Moments critiques : jour de la semaine × tranche de 4 heures. Une seule teinte (l'encre),
  // du plus clair au plus foncé, pour ne pas la confondre avec la couleur d'un joueur.
  let { data }: { data: number[][] } = $props();

  const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const DAYS_LONG = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  const SLOTS = ['0 h', '4 h', '8 h', '12 h', '16 h', '20 h'];

  let max = $derived(Math.max(1, ...data.flat()));
  let tip = $state<string | null>(null);

  function level(value: number): number {
    if (value === 0) return 0;
    return 0.18 + 0.82 * (value / max);
  }
</script>

<div class="heat">
  <table>
    <caption class="sr-only">Points par jour de la semaine et tranche de 4 heures</caption>
    <thead>
      <tr>
        <th scope="col"><span class="sr-only">Jour</span></th>
        {#each SLOTS as slot (slot)}<th scope="col">{slot}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each data as row, d (d)}
        <tr>
          <th scope="row">{DAYS[d]}</th>
          {#each row as value, s (s)}
            {@const l = level(value)}
            <td>
              <button
                type="button"
                class="cell"
                class:dark={l > 0.55}
                style:--level={`${Math.round(l * 100)}%`}
                aria-label="{DAYS_LONG[d]}, {s * 4} h à {s * 4 + 4} h : {value} point{value > 1 ? 's' : ''}"
                onclick={() => (tip = `${DAYS_LONG[d]}, ${s * 4} h – ${s * 4 + 4} h : ${value} point${value > 1 ? 's' : ''}`)}
              >
                {value || ''}
              </button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="legend">
    <span role="status">{tip ?? 'Touche une case pour le détail.'}</span>
    <span class="scale" aria-hidden="true"><i></i>moins → plus</span>
  </div>
</div>

<style>
  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 2px;
    table-layout: fixed;
  }
  th {
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--ink-3);
  }
  thead th:first-child,
  tbody th {
    width: 34px;
    text-align: left;
  }
  td {
    padding: 0;
  }
  .cell {
    display: block;
    width: 100%;
    aspect-ratio: 1.6;
    border: 0;
    border-radius: 3px;
    background: color-mix(in oklab, var(--ink) var(--level), var(--sunken));
    color: var(--ink);
    font-size: var(--t-xs);
    font-weight: 700;
    padding: 0;
  }
  .cell.dark {
    color: var(--paper);
  }
  .legend {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
    font-size: var(--t-xs);
    color: var(--ink-3);
  }
  .scale {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .scale i {
    display: inline-block;
    width: 44px;
    height: 8px;
    border-radius: 2px;
    background: linear-gradient(90deg, color-mix(in oklab, var(--ink) 18%, var(--sunken)), var(--ink));
  }
</style>
