<script setup lang="ts">
/**
 * 共用单局状态栏（PRD §5.2 / document/ui.md 顶栏布局）
 * 用于 BattleView / RunView / SettlementView 等所有需要显示角色基础信息与遗物的视图
 * 含菜单/卡组弹窗（共用弹窗由组件内维护）
 */
import { ref, computed } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { getCard, getRelic } from '@/data'
import CardView from '@/components/common/CardView.vue'

const store = useGameStore()

// ===== 弹窗 =====
const showDeck = ref(false)
const showMenu = ref(false)

// 遗物栏（替换"页签遗物"小标题）
const relicChips = computed(() =>
  (store.run?.relics ?? []).map((id) => {
    const r = getRelic(id)
    return r ? { id, name: r.name } : { id, name: id }
  }),
)

// 在 BattleView 中需要 turn + maxHp（来自 battle ctx）；在地图页只有 run.hp/maxHp
interface Props {
  // 战斗上下文（可选）；地图/结算页可不传
  playerHp?: number
  playerMaxHp?: number
  playerBlock?: number
  playerStrength?: number
  turn?: number
  energy?: number
  maxEnergy?: number
}

const props = withDefaults(defineProps<Props>(), {
  playerHp: 0,
  playerMaxHp: 0,
  playerBlock: 0,
  playerStrength: 0,
  turn: 0,
  energy: 0,
  maxEnergy: 0,
})

// HP 来源：battle 时取 props.playerHp；地图时取 store.run.hp
const hpCurrent = computed(() =>
  props.playerHp > 0 ? props.playerHp : store.run ? store.run.hp : 0,
)
const hpMax = computed(() =>
  props.playerMaxHp > 0 ? props.playerMaxHp : store.run ? store.run.maxHp : 0,
)
const hpPercent = computed(() =>
  hpMax.value > 0 ? Math.max(0, (hpCurrent.value / hpMax.value) * 100) : 0,
)

const turnLabel = computed(() => (props.turn > 0 ? `回合 ${props.turn}` : ''))
const isBoss = computed(() => store.battleKind === 'boss')

// 放弃本局
function abandon(): void {
  store.abandonRun()
}
</script>

<template>
  <div v-if="store.run" class="status-bar">
    <!-- ① 顶栏：基础信息 -->
    <header class="top-bar">
      <div class="top-left">
        <span class="avatar" title="铁甲战士">⚔️</span>
        <span class="hp">
          <span class="hp-bar">
            <span class="hp-fill" :style="{ width: hpPercent + '%' }" />
          </span>
          ❤ {{ hpCurrent }}/{{ hpMax }}
        </span>
        <span class="gold">💰 {{ store.run.gold }}</span>
        <span class="potion-slot" title="药水系统未上线">药水（—）</span>
        <span class="floor">第 {{ store.run.floor }} 层</span>
        <span v-if="isBoss" class="boss-tag">BOSS</span>
        <span v-if="props.playerBlock" class="block">🛡 {{ props.playerBlock }}</span>
        <span v-if="props.playerStrength" class="str">力量 {{ props.playerStrength }}</span>
      </div>
      <div class="top-right">
        <span v-if="turnLabel" class="turn">{{ turnLabel }}</span>
        <span v-if="props.energy > 0 || props.maxEnergy > 0" class="energy">
          ⚡ {{ props.energy }}/{{ props.maxEnergy }}
        </span>
        <button class="btn top-btn" title="查看当前牌组" @click.stop="showDeck = !showDeck">
          卡组
        </button>
        <button class="btn top-btn" title="暂停菜单" @click.stop="showMenu = true">菜单</button>
      </div>
    </header>

    <!-- ② 遗物栏 -->
    <div class="relic-bar">
      <span class="relic-label">遗物</span>
      <span v-for="r in relicChips" :key="r.id" class="relic-chip">{{ r.name }}</span>
    </div>

    <!-- 弹窗：卡组 -->
    <div v-if="showDeck" class="modal" @click.stop>
      <div class="modal-panel panel">
        <h3 class="modal-title">卡组（{{ store.run.deck.length }}）</h3>
        <div class="modal-cards">
          <CardView v-for="(id, i) in store.run.deck" :key="i" :card="getCard(id)" />
        </div>
        <button class="btn" @click="showDeck = false">关闭</button>
      </div>
    </div>

    <!-- 弹窗：菜单 -->
    <div v-if="showMenu" class="modal" @click.stop>
      <div class="modal-panel panel">
        <h3 class="modal-title">菜单</h3>
        <div class="menu-btns">
          <button class="btn btn-primary" @click="showMenu = false">继续游戏</button>
          <button class="btn" @click="abandon">放弃本局（回主菜单）</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.status-bar {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 18px 6px;
  border-bottom: 1px solid var(--border);
}
.top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 14px;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.avatar {
  font-size: 20px;
}
.hp {
  color: var(--accent-strong);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.hp-bar {
  width: 80px;
  height: 9px;
  border: 1px solid var(--border-strong);
  border-radius: 5px;
  background: var(--bg-deep);
  overflow: hidden;
}
.hp-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-dim), var(--accent-strong));
}
.gold {
  color: var(--gold);
}
.potion-slot {
  color: var(--text-faint);
  font-size: 12px;
}
.floor {
  color: var(--text-dim);
}
.boss-tag {
  color: var(--accent-strong);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 0 6px;
  font-size: 12px;
}
.block {
  color: #6aa8d6;
}
.str {
  color: var(--gold);
}
.top-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.turn,
.energy {
  color: var(--text-dim);
  font-size: 13px;
}
.energy {
  color: var(--gold);
}
.top-btn {
  font-size: 13px;
  padding: 4px 10px;
}
.relic-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  flex-wrap: wrap;
}
.relic-label {
  font-size: 12px;
  color: var(--text-faint);
}
.relic-chip {
  font-size: 12px;
  color: var(--gold);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 8px;
  background: rgba(201, 162, 39, 0.08);
}
.modal {
  position: fixed;
  inset: 0;
  background: rgba(10, 8, 7, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-panel {
  max-width: 720px;
  max-height: 80vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-title {
  color: var(--accent-strong);
}
.modal-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.menu-btns {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
