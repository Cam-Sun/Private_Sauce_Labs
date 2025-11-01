import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import '../src/index.css';

export const parameters = {
    actions: { argTypesRegex: '^on[A-Z].*' },
};

export const decorators = [
    (Story) => (
        <MemoryRouter initialEntries={['/']}>
            <Story />
        </MemoryRouter>
    ),
];
