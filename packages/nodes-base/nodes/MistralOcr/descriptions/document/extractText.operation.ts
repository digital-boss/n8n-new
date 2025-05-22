import type { INodeProperties } from 'n8n-workflow';
import { updateDisplayOptions } from 'n8n-workflow';

const properties: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'model',
		type: 'options',
		options: [
			{
				name: 'mistral-ocr-latest',
				value: 'mistral-ocr-latest',
			},
		],
		description: 'The OCR model to use',
		required: true,
		default: 'mistral-ocr-latest',
	},
	{
		displayName: 'Input Type',
		name: 'inputType',
		type: 'options',
		options: [
			{
				name: 'Binary Data',
				value: 'binary',
			},
			{
				name: 'URL',
				value: 'url',
			},
		],
		description: 'How the document will be provided',
		required: true,
		default: 'binary',
	},
	{
		displayName: 'Binary Property',
		name: 'binaryProperty',
		type: 'string',
		description: 'Name of the binary property that contains the file to process',
		placeholder: 'e.g. data',
		hint: 'Uploaded document files must not exceed 50 MB in size and should be no longer than 1,000 pages.',
		required: true,
		default: 'data',
		displayOptions: {
			show: {
				inputType: ['binary'],
			},
		},
	},
	{
		displayName: 'Document URL',
		name: 'documentUrl',
		type: 'string',
		description: 'URL of the document to process',
		placeholder: 'e.g. https://example.com/document.pdf',
		required: true,
		default: '',
		displayOptions: {
			show: {
				inputType: ['url'],
			},
		},
	},
	{
		displayName: 'Enable Batch Processing',
		name: 'enableBatchProcessing',
		type: 'boolean',
		description: 'Whether to process multiple documents in a single API call (more cost-efficient)',
		default: false,
	},
	{
		displayName: 'Batch Size',
		name: 'batchSize',
		type: 'number',
		description: 'Maximum number of documents to process in a single batch',
		default: 25,
		typeOptions: {
			minValue: 1,
			maxValue: 100,
		},
		required: true,
		displayOptions: {
			show: {
				enableBatchProcessing: [true],
			},
		},
	},
];

const displayOptions = {
	show: {
		resource: ['document'],
		operation: ['extractText'],
	},
};

export const description = updateDisplayOptions(displayOptions, properties);
