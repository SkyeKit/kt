<script setup lang="ts">
/**
 * 调试控制台（PRD §3.10）：MVP 内置作弊/调试命令
 * 命令：help / gold N / heal N / add cardId / relic id / kill / next / seed
 */
import { ref } from 'vue'
import { useGameStore } from '@/stores/gameStore'
import { cardsData, getRelic } from '@/data'

const store = useGameStore()
const input = ref('')
const output = ref<string[]>(['输入 help 查看命令'])

// 执行命令
function run(): void {
  const cmd = input.value.trim()
  input.value = ''
  if (!cmd) return
  const [head, ...rest] = cmd.split(/\s+/)
  const r = store.run
  switch (head) {
    case 'help':
      output.value.push(
        '命令：gold N / heal N / add <卡牌id> / relic <遗物id> / kill / hp N / maxhp N',
      )
      break
    case 'gold':
      if (r && rest[0]) {
        r.gold += parseInt(rest[0], 10)
        output.value.push(`金币 +${rest[0]}（当前 ${r.gold}）`)
      }
      break
    case 'heal':
      if (r && rest[0]) {
        r.hp = Math.min(r.maxHp, r.hp + parseInt(rest[0], 10))
        output.value.push(`回复 ${rest[0]} 点生命`)
      }
      break
    case 'maxhp':
      if (r && rest[0]) {
        r.maxHp = parseInt(rest[0], 10)
        r.hp = Math.min(r.hp, r.maxHp)
        output.value.push(`最大生命设为 ${rest[0]}`)
      }
      break
    case 'add': {
      if (!r || !rest[0]) break
      const card =
        cardsData.warrior.find((c) => c.id === rest[0]) ??
        cardsData.warrior.find((c) => c.name === rest[0])
      if (card) {
        r.deck.push(card.id)
        output.value.push(`已将【${card.name}】加入牌组`)
      } else {
        output.value.push(`未找到卡牌：${rest[0]}`)
      }
      break
    }
    case 'relic': {
      if (!r || !rest[0]) break
      const relic = getRelic(rest[0])
      if (relic) {
        r.relics.push(relic.id)
        output.value.push(`获得遗物【${relic.name}】`)
      } else {
        output.value.push(`未找到遗物：${rest[0]}`)
      }
      break
    }
    case 'kill':
      if (store.battle) {
        for (const e of store.battle.enemies) {
          e.hp = 0
          e.alive = false
        }
        store.endTurn() // 触发结算
        output.value.push('已击杀全部敌人')
      }
      break
    case 'seed':
      output.value.push(`本局种子：${r?.seed ?? '无'}`)
      break
    default:
      output.value.push(`未知命令：${head}（输入 help 查看）`)
  }
  if (output.value.length > 30) output.value.splice(0, output.value.length - 30)
}

// 常用卡牌 id 提示
const quickCards = ['bash', 'cleave', 'whirlwind', 'perfected_strike', 'demon_form']
</script>

<template>
  <div class="console-panel panel">
    <h4 class="console-title">调试控制台</h4>
    <div class="console-output">
      <p v-for="(line, i) in output" :key="i">{{ line }}</p>
    </div>
    <input
      v-model="input"
      class="console-input"
      placeholder="输入命令，回车执行"
      @keyup.enter="run"
    />
    <div class="console-quick">
      <button v-for="c in quickCards" :key="c" class="btn quick" @click="input = 'add ' + c">
        {{ c }}
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.console-panel {
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.console-title {
  color: var(--gold);
}
.console-output {
  height: 120px;
  overflow: auto;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 4px;
  padding: 6px;
  color: var(--text-dim);
  line-height: 1.6;
}
.console-input {
  background: var(--bg-deep);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--text-main);
  padding: 6px 8px;
  font-family: inherit;
}
.console-quick {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.quick {
  font-size: 11px;
  padding: 2px 6px;
}
</style>
