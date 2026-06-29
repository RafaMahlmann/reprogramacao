import './style.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) startApp(root);
