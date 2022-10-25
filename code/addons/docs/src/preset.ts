/* eslint-disable camelcase */
import fs from 'fs-extra';
import remarkSlug from 'remark-slug';
import remarkExternalLinks from 'remark-external-links';

import type {
  CoreCommon_IndexerOptions,
  CoreCommon_StoryIndexer,
  DocsOptions,
  Options,
} from '@storybook/types';
import { logger } from '@storybook/node-logger';
import { loadCsf } from '@storybook/csf-tools';

// for frameworks that are not working with react, we need to configure
// the jsx to transpile mdx, for now there will be a flag for that
// for more complex solutions we can find alone that we need to add '@babel/plugin-transform-react-jsx'
type BabelParams = {
  babelOptions?: any;
  mdxBabelOptions?: any;
  configureJSX?: boolean;
};
function createBabelOptions({ babelOptions, mdxBabelOptions, configureJSX }: BabelParams) {
  const babelPlugins = mdxBabelOptions?.plugins || babelOptions?.plugins || [];

  const filteredBabelPlugins = babelPlugins.filter((p: any) => {
    const name = Array.isArray(p) ? p[0] : p;
    if (typeof name === 'string') {
      return !name.includes('plugin-transform-react-jsx');
    }
    return true;
  });

  const jsxPlugin = [
    require.resolve('@babel/plugin-transform-react-jsx'),
    { pragma: 'React.createElement', pragmaFrag: 'React.Fragment' },
  ];
  const plugins = configureJSX ? [...filteredBabelPlugins, jsxPlugin] : babelPlugins;
  return {
    // don't use the root babelrc by default (users can override this in mdxBabelOptions)
    babelrc: false,
    configFile: false,
    ...babelOptions,
    ...mdxBabelOptions,
    plugins,
  };
}

export async function webpack(
  webpackConfig: any = {},
  options: Options &
    BabelParams & { sourceLoaderOptions: any; transcludeMarkdown: boolean } /* & Parameters<
      typeof createCompiler
    >[0] */
) {
  const resolvedBabelLoader = await options.presets.apply('babelLoaderRef');

  const { module = {} } = webpackConfig;

  // it will reuse babel options that are already in use in storybook
  // also, these babel options are chained with other presets.
  const {
    babelOptions,
    mdxBabelOptions,
    configureJSX = true,
    sourceLoaderOptions = { injectStoryParameters: true },
    transcludeMarkdown = false,
  } = options;

  const mdxLoaderOptions = {
    // whether to skip storybook files, useful for docs only mdx or md files
    skipCsf: true,
    remarkPlugins: [remarkSlug, remarkExternalLinks],
  };

  logger.info(`Addon-docs: using MDX2`);

  const mdxLoader = require.resolve('@storybook/mdx2-csf/loader');

  // set `sourceLoaderOptions` to `null` to disable for manual configuration
  const sourceLoader = sourceLoaderOptions
    ? [
        {
          test: /\.(stories|story)\.[tj]sx?$/,
          loader: require.resolve('@storybook/source-loader'),
          options: { ...sourceLoaderOptions, inspectLocalDependencies: true },
          enforce: 'pre',
        },
      ]
    : [];

  let rules = module.rules || [];
  if (transcludeMarkdown) {
    rules = [
      ...rules.filter((rule: any) => rule.test?.toString() !== '/\\.md$/'),
      {
        test: /\.md$/,
        use: [
          {
            loader: resolvedBabelLoader,
            options: createBabelOptions({ babelOptions, mdxBabelOptions, configureJSX }),
          },
          {
            loader: mdxLoader,
            options: mdxLoaderOptions,
          },
        ],
      },
    ];
  }

  const result = {
    ...webpackConfig,
    module: {
      ...module,
      rules: [
        ...rules,
        {
          test: /(stories|story)\.mdx$/,
          use: [
            {
              loader: resolvedBabelLoader,
              options: createBabelOptions({ babelOptions, mdxBabelOptions, configureJSX }),
            },
            {
              loader: mdxLoader,
              options: {
                ...mdxLoaderOptions,
                skipCsf: false,
              },
            },
          ],
        },
        {
          test: /\.mdx$/,
          exclude: /(stories|story)\.mdx$/,
          use: [
            {
              loader: resolvedBabelLoader,
              options: createBabelOptions({ babelOptions, mdxBabelOptions, configureJSX }),
            },
            {
              loader: mdxLoader,
              options: mdxLoaderOptions,
            },
          ],
        },
        ...sourceLoader,
      ],
    },
  };

  return result;
}

export const storyIndexers = async (indexers: CoreCommon_StoryIndexer[] | null) => {
  const mdxIndexer = async (fileName: string, opts: CoreCommon_IndexerOptions) => {
    let code = (await fs.readFile(fileName, 'utf-8')).toString();
    // @ts-expect-error (Converted from ts-ignore)
    const { compile } = await import('@storybook/mdx2-csf');
    code = await compile(code, {});
    return loadCsf(code, { ...opts, fileName }).parse();
  };
  return [
    {
      test: /(stories|story)\.mdx$/,
      indexer: mdxIndexer,
      addDocsTemplate: true,
    },
    ...(indexers || []),
  ];
};

export const docs = (docsOptions: DocsOptions) => {
  return {
    ...docsOptions,
    enabled: true,
    defaultName: 'Docs',
    docsPage: true,
  };
};
