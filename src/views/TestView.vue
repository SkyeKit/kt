<script setup lang="ts">
/**
 * 测试场（木桩，PRD §3.10）：独立于单局的对战测试
 * 使用当前牌组对抗固定木桩（HP 300，无攻击），可无限测试卡牌/遗物组合
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '@/stores/gameStore'
import { getCard } from '@/data'
import {
  createCombatContext,
  startCombat,
  playCard as enginePlay,
  checkResult,
} from '@/engine/combatEngine'
import type { CombatContext } from '@/engine/combatEngine'

const router = useRouter()
const store = useGameStore()
const ctx = ref<CombatContext | null>(null)
const log = ref<string[]>([])
const log2 = ref<string[]>([])

// 初始化木桩战斗（默认牌组：打击×5 防御×4 痛击×1；可带入当前局牌组）
function startTest(withRunDeck = false): void {
  const deck =
    withRunDeck && store.run
      ? store.run.deck
      : [
          'strike_ironclad',
          'strike_ironclad',
          'strike_ironclad',
          'strike_ironclad',
          'strike_ironclad',
          'defend_ironclad',
          'defend_ironclad',
          'defend_ironclad',
          'defend_ironclad',
          'bash',
        ]
  ctx.value = createCombatContext({ id: 'test', name: '铁甲战士', hp: 80, maxHp: 80, deck }, [
    { id: 'dummy', name: '木桩', hp: 300, maxHp: 300 },
  ])
  startCombat(ctx.value)
  log.value = ['测试开始：木桩 HP 300']
  log2.value = []
}

// 打出卡牌（测试场不触发遗物）
function play(cardId: string): void {
  const c = ctx.value
  if (!c) return
  const card = getCard(cardId)
  if (!card) return
  const ok = enginePlay(c, card)
  if (ok) log.value.push(...c.log.slice(-8))
  const r = checkResult(c)
  if (r.status === 'victory') log.value.push('木桩被击倒了！重置 HP 继续测试')
}

// 返回主菜单
function back(): void {
  router.push('/')
}
</script>

<template>
  <div class="test">
    <h1 class="h-title">测试场（木桩）</h1>
    <div class="test-actions">
      <button class="btn btn-primary" @click="startTest(false)">开始测试（基础牌组）</button>
      <button class="btn" @click="startTest(true)">使用当前局牌组</button>
      <button class="btn" @click="back">返回主菜单</button>
    </div>

    <div v-if="ctx" class="test-body">
      <div class="test-enemy">
        <EnemyView :unit="ctx.enemies[0]!" />
      </div>
      <div class="test-player">
        HP {{ ctx.player.hp }}/{{ ctx.player.maxHp }}｜能量 {{ ctx.energy }}/{{
          ctx.maxEnergy
        }}｜格挡 {{ ctx.player.block }}
      </div>
      <div class="test-hand">
        <CardView
          v-for="h in ctx.hand"
          :key="h"
          :card="getCard(h)"
          :playable="true"
          @select="play(h)"
        />
      </div>
      <div class="test-log">
        <p v-for="(line, i) in log.slice(-12)" :key="i">{{ line }}</p>
      </div>
    </div>
    <p v-else class="test-tip">点击「开始测试」进入木桩对战</p>
  </div>
</template>

<style scoped lang="scss">
.test {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 24px;
}
.test-actions {
  display: flex;
  gap: 10px;
}
.test-body {
  width: 100%;
  max-width: 760px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.test-enemy {
  display: flex;
  justify-content: center;
}
.test-player {
  text-align: center;
  color: var(--text-dim);
}
.test-hand {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
}
.test-log {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-dim);
  height: 140px;
  overflow: auto;
}
.test-tip {
  color: var(--text-faint);
}
</style>
