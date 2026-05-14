const path = require('path');

module.exports = {
  mode: process.env.NODE_ENV || 'development',
  target: 'electron-main',
  entry: './src/main/index.ts',
  output: {
    path: path.resolve(__dirname, '.webpack', 'main'),
    filename: 'index.js',
    devtoolModuleFilenameTemplate: '[absolute-resource-path]',
  },
  externals: {
    'node-pty': 'commonjs node-pty',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
          },
        },
      },
    ],
  },
  node: {
    __dirname: false,
    __filename: false,
  },
};
