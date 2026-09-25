<div align="center">

## 🧪 What is VeTwo?

### Veterinary Knowledge × Engineering Infrastructure

</div>

<table>
<tr>
<td width="50%" valign="top">

### ⚙️ Scientific Engine

A dependency-free unit and dimensional-analysis engine designed to prevent invalid scientific calculations.

**Example**

`mg/kg` ≠ `%`

Units that cannot be mathematically combined should never silently produce a valid-looking result.

</td>

<td width="50%" valign="top">

### 🥬 Nutrition Layer

A domain layer built on top of the unit engine for animal nutrition and feed formulation.

It transforms unit-safe feed and animal data into values that optimization systems can consume directly.

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 🐄 Applications

The mathematical and domain layers eventually become real veterinary and animal-nutrition applications.

The goal is to move from **scientific correctness → usable software**.

</td>

<td width="50%" valign="top">

### 🛠️ Developer Infrastructure

CLI tooling, project intelligence, documentation generation, package registries, scaffolding, and supporting infrastructure help keep the ecosystem consistent.

</td>
</tr>
</table>

---

<div align="center">

## 🌱 VeTwo Ecosystem

**Small packages. Clear responsibilities. One ecosystem.**

</div>

<!-- AUTO:ECOSYSTEM:START -->

<table>
<tr>
<td width="50%" valign="top">

### ⚙️ Core Engine

- [`units`](https://github.com/VeTwo-dev/units)  
  Small, dependency-free scientific unit & dimensional-analysis engine for TypeScript.

</td>
<td width="50%" valign="top">

### 🧬 Domain Layer

- [`nutrition-units`](https://github.com/VeTwo-dev/nutrition-units)  
  Nutrition & feed-formulation calculation rules built on `@vetwo/units`.

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 🐄 Applications

- [`Feed-Formulation`](https://github.com/VeTwo-dev/Feed-Formulation)

</td>
<td width="50%" valign="top">

### 🛠️ Developer Tools

- [`whichenv`](https://github.com/VeTwo-dev/whichenv)
- [`Repo-Fetch`](https://github.com/VeTwo-dev/Repo-Fetch)
- [`Cli-sound`](https://github.com/VeTwo-dev/Cli-sound)
- [`Create-VeTwo-Pack`](https://github.com/VeTwo-dev/Create-VeTwo-Pack)

</td>
</tr>

<tr>
<td width="50%" valign="top">

### 📦 Infrastructure

- [`VeTwo-Market-Place`](https://github.com/VeTwo-dev/VeTwo-Market-Place)  
  Git-based registry for reusable VeTwo resources.

</td>
<td width="50%" valign="top">

### 📚 Documentation

- [`Docs`](https://github.com/VeTwo-dev/Docs)  
  Documentation generator for JavaScript & TypeScript projects.

</td>
</tr>
</table>

<!-- AUTO:ECOSYSTEM:END -->
