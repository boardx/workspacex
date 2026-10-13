import {defineConfig} from '@playwright/test';
import images from './board-durable-images.config';
/** Uses an existing isolated, seeded runtime. No services or database mutation. */
export default defineConfig({...images,testMatch:'board-multi-image-upload.spec.ts'});
