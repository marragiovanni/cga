/**
 * App entry — mounts the Svelte application. All state and behavior
 * live in App.svelte and the components it composes; this file only
 * loads the stylesheets and attaches the root component.
 */

import "@lichess-org/chessground/assets/chessground.base.css";
import "@lichess-org/chessground/assets/chessground.brown.css";
import "@lichess-org/chessground/assets/chessground.cburnett.css";
import "./app.css";

import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app element in index.html");

mount(App, { target });
