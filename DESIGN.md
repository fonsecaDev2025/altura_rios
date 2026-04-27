---
version: "alpha"
name: Altura Ríos
description: Dashboard de niveles hidrométricos — estilo arena cálida con acentos de agua y fuego.
colors:
  primary: "#1a2332"
  secondary: "#5c6575"
  tertiary: "#1e5f8a"
  tertiary-light: "#2d7ab5"
  accent: "#b24e1e"
  neutral: "#f4efe6"
  neutral-dark: "#e8dfd0"
  surface: "#fffdf9"
  on-tertiary: "#ffffff"
typography:
  h1:
    fontFamily: Fraunces
    fontSize: 2.75rem
    fontWeight: 600
    letterSpacing: -0.02em
  body-md:
    fontFamily: DM Sans
    fontSize: 1rem
    lineHeight: 1.5
  label-caps:
    fontFamily: DM Sans
    fontSize: 0.8rem
    fontWeight: 600
    letterSpacing: 0.12em
  mono:
    fontFamily: JetBrains Mono
    fontSize: 0.92rem
rounded:
  sm: 8px
  md: 14px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
components:
  button-primary:
    backgroundColor: "{colors.tertiary}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.pill}"
    padding: 12px
  button-primary-hover:
    backgroundColor: "{colors.tertiary-light}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.tertiary}"
    rounded: "{rounded.pill}"
  tab:
    textColor: "{colors.secondary}"
    typography: "{typography.body-md}"
  tab-active:
    textColor: "{colors.tertiary}"
  chip:
    backgroundColor: "{colors.neutral}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 8px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: 16px
  alert:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-tertiary}"
    rounded: "{rounded.md}"
    padding: 8px
  hero:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
  page:
    backgroundColor: "{colors.neutral-dark}"
---

## Overview

Arena y Agua — un dashboard hidrométrico con identidad cálida y profesional.
La UI evoca un diario de calidad: fondo arena suave, tipografía serif en
títulos (Fraunces), sans-serif limpio en cuerpo (DM Sans) y monoespaciada
para datos numéricos (JetBrains Mono). El acento azul agua guía la
interacción; el naranja fuego señala alertas y estados excepcionales.

## Colors

La paleta se ancla en contrastes arena/tinta con dos acentos funcionales.

- **Primary (#1a2332):** Tinta profunda para encabezados y texto principal.
- **Secondary (#5c6575):** Gris pizarra para metadatos, subtítulos y bordes.
- **Tertiary (#1e5f8a):** Azul agua — color de acción e interactividad.
- **Accent (#c45c26):** Naranja fuego — alertas, avisos, estados críticos.
- **Neutral (#f4efe6):** Arena cálida, fondo general de la aplicación.
- **Surface (#fffdf9):** Blanco cálido para tarjetas y zonas elevadas.

## Typography

Tres familias tipográficas con roles definidos:

- **Fraunces** (display): títulos hero, h1. Peso 600, tracking negativo.
- **DM Sans** (body): texto general, labels, botones. Limpio y legible.
- **JetBrains Mono** (mono): datos numéricos en tablas, valores de alturas.

## Layout

- Ancho máximo: `min(1600px, 100%)`.
- Paddings laterales responsivos: `clamp(1rem, 4vw, 3rem)`.
- Gaps en flex/grid: `0.65rem` – `0.85rem`.
- Hero con gradiente de surface a transparente sobre fondo arena.

## Components

### Botones

- **Primary**: pill (border-radius 999px), fondo azul agua, texto blanco.
  Hover: azul agua claro.
- **Ghost**: pill, fondo transparente, texto azul agua. Hover: tinte azul 8%.

### Tabs

Pestañas horizontales con borde inferior. Tab activo: azul agua con borde.

### Chips / Meta

Badges con fondo arena, radio 14px. Variante bloque para metadatos.

### Tabla de datos

Header con gradiente gris-azulado. Celdas numéricas en JetBrains Mono.
Badges de estado: baja (verde), crece (rojo), estacionario (gris).

## Do's and Don'ts

- **Sí**: usar el azul agua exclusivamente para acciones interactivas.
- **Sí**: mantener el fondo arena como base; evitar blanco puro (#fff).
- **No**: usar el naranja acento para botones primarios (reservado para alertas).
- **No**: mezclar serif (Fraunces) en cuerpo de texto; es solo para títulos.
