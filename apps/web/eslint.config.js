import tseslint from 'typescript-eslint'
export default [...tseslint.configs.recommended, { ignores: ['dist/**', 'src/routeTree.gen.ts'] }]
