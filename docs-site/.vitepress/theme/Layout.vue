<!-- Modified by CyberNova for the CloudForge fork (forked 2026-10-22). Originally Apache-2.0 (see LICENSES/Apache-2.0.txt). -->
<script setup>
import DefaultTheme from 'vitepress/theme';
</script>

<template>
  <DefaultTheme.Layout>
    <template #layout-top>
      <!-- 装饰层：蓝色顶带 + 环境光晕。纯装饰，aria-hidden。 -->
      <div class="cn-deco" aria-hidden="true">
        <i class="cn-deco__band"></i>
        <i class="cn-deco__orb cn-deco__orb--a"></i>
        <i class="cn-deco__orb cn-deco__orb--b"></i>
        <i class="cn-deco__orb cn-deco__orb--c"></i>
      </div>
    </template>
  </DefaultTheme.Layout>
</template>
