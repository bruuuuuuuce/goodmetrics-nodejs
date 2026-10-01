/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  moduleNameMapper: {
    '^@src$': '<rootDir>/src/index.ts',
    '^@src/(.*)$': '<rootDir>/src/$1',
  },
};
