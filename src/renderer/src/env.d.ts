/// <reference types="vite/client" />

declare module '~icons/*' {
  import { FunctionalComponent, SVGAttributes } from 'vue';
  const component: FunctionalComponent<SVGAttributes>;
  export default component;
}

interface Window {
  api: any;
  electron: any;
}
