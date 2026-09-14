import { createApp } from "vue";
import "./style.css";
import App from "./App.vue";
import "@fortawesome/fontawesome-free/css/all.min.css";
import { initAnalytics } from "./utils/analytics";
import { disableMobileTextSelection } from "./utils/disableMobileSelection";

initAnalytics();
disableMobileTextSelection();
createApp(App).mount("#app");
