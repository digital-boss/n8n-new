import type { INodeProperties } from 'n8n-workflow';

import * as extractedText from './extractText.operation';
import { processResponseData, sendErrorPostReceive } from '../../GenericFunctions';

export const description: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: {
				resource: ['document'],
			},
		},
		options: [
			{
				name: 'Extract Text',
				value: 'extractText',
				description: 'Extract text from document using OCR',
				action: 'Extract text',
				routing: {
					request: {
						method: 'POST',
						url: '/v1/ocr',
						headers: {
							'Content-Type': 'application/json',
						},
					},
					output: {
						postReceive: [sendErrorPostReceive, processResponseData],
					},
				},
			},
		],
		default: 'extractText',
	},

	...extractedText.description,
];
